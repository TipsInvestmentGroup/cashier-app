import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/**
 * Clone a template's entire tree (stages → sections → fields) and its
 * validation rules under a new name. The copy is created inactive — an
 * admin reviews it in the editor and flips it Active when ready, so a
 * half-checked duplicate never shows up for cashiers by accident.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !(await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_TEMPLATES, 'add'))) {
    return NextResponse.json({ error: 'You are not authorized to duplicate collection templates' }, { status: 403 })
  }

  const { id } = await params
  const source = await prisma.collectionTemplate.findUnique({
    where: { id },
    include: {
      validationRules: true,
      stages: { orderBy: { order: 'asc' }, include: { sections: { orderBy: { order: 'asc' }, include: { fields: { orderBy: { order: 'asc' } } } } } },
    },
  })
  if (!source) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const baseName = `${source.name} (Copy)`
  let name = baseName
  let code = toCode(name)
  for (let n = 2; await prisma.collectionTemplate.findUnique({ where: { code } }); n++) {
    name = `${baseName} ${n}`
    code = toCode(name)
  }

  const copy = await prisma.$transaction(async (tx) => {
    const newTemplate = await tx.collectionTemplate.create({
      data: { companyId: source.companyId, code, name, description: source.description, isDefault: false, isActive: false },
    })

    for (const stage of source.stages) {
      const newStage = await tx.collectionStage.create({
        data: { templateId: newTemplate.id, key: stage.key, label: stage.label, order: stage.order, isOptional: stage.isOptional, entryMode: stage.entryMode },
      })
      for (const section of stage.sections) {
        const newSection = await tx.collectionSection.create({
          data: { stageId: newStage.id, key: section.key, label: section.label, order: section.order, isMandatory: section.isMandatory },
        })
        for (const field of section.fields) {
          await tx.collectionField.create({
            data: { sectionId: newSection.id, key: field.key, label: field.label, fieldType: field.fieldType, order: field.order, isRequired: field.isRequired, config: field.config },
          })
        }
      }
    }
    for (const rule of source.validationRules) {
      await tx.collectionValidationRule.create({
        data: { templateId: newTemplate.id, ruleType: rule.ruleType, config: rule.config, isActive: rule.isActive },
      })
    }

    await tx.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'CollectionTemplate', entityId: newTemplate.id, details: `Duplicated from "${source.name}" (${source.id})` } })
    return newTemplate
  })

  return NextResponse.json(copy, { status: 201 })
}
