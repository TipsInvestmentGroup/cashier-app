import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'

const FIELD_TYPES = ['NUMBER', 'TEXT', 'SELECT', 'STAFF_PICKER', 'PERSON_PICKER', 'DATE', 'BOOLEAN']
const ENTRY_MODES = ['SINGLE_STAFF', 'MULTI_STAFF_GRID', 'BATCH', 'EXCEL_IMPORT', 'POS_SYNC']

interface FieldInput { id?: string; key: string; label: string; fieldType: string; order?: number; isRequired?: boolean; config?: string | null }
interface SectionInput { id?: string; key: string; label: string; order?: number; isMandatory?: boolean; fields?: FieldInput[] }
interface StageInput { id?: string; key: string; label: string; order?: number; isOptional?: boolean; entryMode?: string; sections?: SectionInput[] }
interface RuleInput { id?: string; ruleType: string; config?: string | null; isActive?: boolean }

const RULE_TYPES = ['STAGE_SEQUENCE', 'CASH_NOT_EXCEED_SYSTEM_SALES', 'DISCOUNT_APPROVAL_LIMIT', 'NO_NEGATIVE_BALANCE', 'REQUIRED_FIELD']

/** Full template tree — any authed user (the stage renderer needs it to draw a session's form). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const template = await prisma.collectionTemplate.findUnique({
    where: { id },
    include: {
      validationRules: true,
      stages: {
        orderBy: { order: 'asc' },
        include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } },
      },
    },
  })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  return NextResponse.json(template)
}

/**
 * Save the whole template tree in one shot (name/description/isActive, plus a
 * full stages→sections→fields replace-and-diff). This is an admin config
 * screen, not a high-concurrency write path, so "save the whole tree" is
 * simpler and safer than a dozen fine-grained nested-resource endpoints.
 * Rows omitted from the incoming tree are deleted; the schema's default FK
 * behavior (RESTRICT — no onDelete: Cascade from stage/section/field down to
 * StageRecord/FieldValue) means deleting a stage/section/field that already
 * has real session data attached fails instead of silently orphaning it.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !(await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_TEMPLATES, 'edit'))) {
    return NextResponse.json({ error: 'You are not authorized to edit collection templates' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.collectionTemplate.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { name, description, isActive, stages, validationRules } = body as { name?: string; description?: string | null; isActive?: boolean; stages?: StageInput[]; validationRules?: RuleInput[] }

  if (!Array.isArray(stages)) return NextResponse.json({ error: 'stages must be an array' }, { status: 400 })
  const rules = Array.isArray(validationRules) ? validationRules : []
  for (const r of rules) {
    if (!RULE_TYPES.includes(r.ruleType)) return NextResponse.json({ error: `Invalid rule type: ${r.ruleType}` }, { status: 400 })
    if (r.config) {
      try { JSON.parse(r.config) } catch { return NextResponse.json({ error: 'Rule config must be valid JSON' }, { status: 400 }) }
    }
  }
  for (const s of stages) {
    if (!s.key || !s.label) return NextResponse.json({ error: 'Every stage needs a key and a label' }, { status: 400 })
    if (s.entryMode && !ENTRY_MODES.includes(s.entryMode)) return NextResponse.json({ error: `Invalid entry mode: ${s.entryMode}` }, { status: 400 })
    for (const sec of s.sections || []) {
      if (!sec.key || !sec.label) return NextResponse.json({ error: 'Every section needs a key and a label' }, { status: 400 })
      for (const f of sec.fields || []) {
        if (!f.key || !f.label) return NextResponse.json({ error: 'Every field needs a key and a label' }, { status: 400 })
        if (!FIELD_TYPES.includes(f.fieldType)) return NextResponse.json({ error: `Invalid field type: ${f.fieldType}` }, { status: 400 })
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.collectionTemplate.update({
        where: { id },
        data: {
          ...(name ? { name: String(name).trim() } : {}),
          description: description === undefined ? undefined : description ? String(description).trim() : null,
          ...(isActive === undefined ? {} : { isActive: !!isActive }),
        },
      })

      const existingStages = await tx.collectionStage.findMany({ where: { templateId: id }, select: { id: true } })
      const incomingStageIds = new Set(stages.filter((s) => s.id).map((s) => s.id as string))
      const stagesToDelete = existingStages.filter((s) => !incomingStageIds.has(s.id))
      if (stagesToDelete.length) await tx.collectionStage.deleteMany({ where: { id: { in: stagesToDelete.map((s) => s.id) } } })

      for (const [stageOrder, s] of stages.entries()) {
        const stage = s.id
          ? await tx.collectionStage.update({
              where: { id: s.id },
              data: { key: s.key, label: s.label, order: stageOrder, isOptional: !!s.isOptional, entryMode: s.entryMode || 'SINGLE_STAFF' },
            })
          : await tx.collectionStage.create({
              data: { templateId: id, key: s.key, label: s.label, order: stageOrder, isOptional: !!s.isOptional, entryMode: s.entryMode || 'SINGLE_STAFF' },
            })

        const existingSections = await tx.collectionSection.findMany({ where: { stageId: stage.id }, select: { id: true } })
        const incomingSectionIds = new Set((s.sections || []).filter((sec) => sec.id).map((sec) => sec.id as string))
        const sectionsToDelete = existingSections.filter((sec) => !incomingSectionIds.has(sec.id))
        if (sectionsToDelete.length) await tx.collectionSection.deleteMany({ where: { id: { in: sectionsToDelete.map((sec) => sec.id) } } })

        for (const [sectionOrder, sec] of (s.sections || []).entries()) {
          const section = sec.id
            ? await tx.collectionSection.update({
                where: { id: sec.id },
                data: { key: sec.key, label: sec.label, order: sectionOrder, isMandatory: !!sec.isMandatory },
              })
            : await tx.collectionSection.create({
                data: { stageId: stage.id, key: sec.key, label: sec.label, order: sectionOrder, isMandatory: !!sec.isMandatory },
              })

          const existingFields = await tx.collectionField.findMany({ where: { sectionId: section.id }, select: { id: true } })
          const incomingFieldIds = new Set((sec.fields || []).filter((f) => f.id).map((f) => f.id as string))
          const fieldsToDelete = existingFields.filter((f) => !incomingFieldIds.has(f.id))
          if (fieldsToDelete.length) await tx.collectionField.deleteMany({ where: { id: { in: fieldsToDelete.map((f) => f.id) } } })

          for (const [fieldOrder, f] of (sec.fields || []).entries()) {
            const data = { key: f.key, label: f.label, fieldType: f.fieldType, order: fieldOrder, isRequired: !!f.isRequired, config: f.config ?? null }
            if (f.id) await tx.collectionField.update({ where: { id: f.id }, data })
            else await tx.collectionField.create({ data: { sectionId: section.id, ...data } })
          }
        }
      }

      const existingRules = await tx.collectionValidationRule.findMany({ where: { templateId: id }, select: { id: true } })
      const incomingRuleIds = new Set(rules.filter((r) => r.id).map((r) => r.id as string))
      const rulesToDelete = existingRules.filter((r) => !incomingRuleIds.has(r.id))
      if (rulesToDelete.length) await tx.collectionValidationRule.deleteMany({ where: { id: { in: rulesToDelete.map((r) => r.id) } } })
      for (const r of rules) {
        const data = { ruleType: r.ruleType, config: r.config ?? null, isActive: r.isActive === undefined ? true : !!r.isActive }
        if (r.id) await tx.collectionValidationRule.update({ where: { id: r.id }, data })
        else await tx.collectionValidationRule.create({ data: { templateId: id, ...data } })
      }

      await tx.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionTemplate', entityId: id, details: `Saved template tree (${stages.length} stage(s), ${rules.length} rule(s))` } })
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return NextResponse.json({ error: 'One of the stages/sections/fields you removed already has collection data recorded against it — it cannot be deleted.' }, { status: 409 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Duplicate key — two stages, sections, or fields have the same key at the same level.' }, { status: 409 })
    }
    throw err
  }

  const saved = await prisma.collectionTemplate.findUnique({
    where: { id },
    include: {
      validationRules: true,
      stages: { orderBy: { order: 'asc' }, include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } } },
    },
  })
  return NextResponse.json(saved)
}

/** Delete a template — ADMIN only. Blocked if it's the default or has any sessions. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !(await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_TEMPLATES, 'delete'))) {
    return NextResponse.json({ error: 'You are not authorized to delete collection templates' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.collectionTemplate.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  if (existing.isDefault) return NextResponse.json({ error: 'The default template cannot be deleted' }, { status: 409 })

  const sessionCount = await prisma.collectionSession.count({ where: { templateId: id } })
  if (sessionCount > 0) return NextResponse.json({ error: 'This template has collection sessions recorded against it and cannot be deleted — disable it instead.' }, { status: 409 })

  await prisma.collectionTemplate.delete({ where: { id } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'CollectionTemplate', entityId: id, details: `Deleted template ${existing.name}` } })
  return NextResponse.json({ ok: true })
}
