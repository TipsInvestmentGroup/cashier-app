// Seeds the "Standard Staff Collection" template: metadata describing today's
// existing fixed Daily Collections form (one stage, one save, next staff).
// This does NOT change where collection data is stored — DailyCollection and
// its children keep being the source of truth for this template. The rows
// here exist so the template/stage/section/field tables are populated and
// outlets have a `defaultTemplateId` to point at, ready for the Template
// Designer (a later phase) to read and for new custom templates to sit
// alongside without special-casing "no template selected".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedStandardCollectionTemplate(prisma: any, outletIds: string[]) {
  const company = await prisma.company.upsert({
    where: { name: 'TIPS Investment Group' },
    update: {},
    create: { name: 'TIPS Investment Group', legalName: 'TIPS INVESTMENT LTD', tin: '132-051-100', vrn: '40-028205-X' },
  })

  const template = await prisma.collectionTemplate.upsert({
    where: { code: 'STANDARD_STAFF_COLLECTION' },
    update: { companyId: company.id, isDefault: true },
    create: {
      companyId: company.id,
      code: 'STANDARD_STAFF_COLLECTION',
      name: 'Standard Staff Collection',
      description: 'One staff → one collection form → save → next staff. The default workflow.',
      isDefault: true,
    },
  })

  const stage = await prisma.collectionStage.upsert({
    where: { templateId_key: { templateId: template.id, key: 'DAILY_COLLECTION' } },
    update: {},
    create: { templateId: template.id, key: 'DAILY_COLLECTION', label: 'Daily Collection', order: 0, entryMode: 'SINGLE_STAFF' },
  })

  const sections: Array<{ key: string; label: string; order: number; isMandatory: boolean; fields: Array<{ key: string; label: string; fieldType: string; order: number; isRequired: boolean }> }> = [
    {
      key: 'SALES', label: 'Sales', order: 0, isMandatory: true,
      fields: [
        { key: 'staff', label: 'Staff (collected from)', fieldType: 'STAFF_PICKER', order: 0, isRequired: true },
        { key: 'systemSales', label: 'System Sales (TZS)', fieldType: 'NUMBER', order: 1, isRequired: true },
      ],
    },
    {
      key: 'PAYMENT_CHANNELS', label: 'Payment Channels', order: 1, isMandatory: true,
      fields: [{ key: 'cash', label: 'Cash', fieldType: 'NUMBER', order: 0, isRequired: false }],
    },
    {
      key: 'BILLS', label: 'Bills', order: 2, isMandatory: false,
      fields: [
        { key: 'signedBills', label: 'Signed Bills', fieldType: 'TEXT', order: 0, isRequired: false },
        { key: 'paidBills', label: 'Paid Bills', fieldType: 'TEXT', order: 1, isRequired: false },
      ],
    },
    {
      key: 'DISCOUNTS', label: 'Discounts', order: 3, isMandatory: false,
      fields: [
        { key: 'discount', label: 'Discount Amount', fieldType: 'NUMBER', order: 0, isRequired: false },
        { key: 'discountReason', label: 'Reason', fieldType: 'TEXT', order: 1, isRequired: false },
      ],
    },
    {
      key: 'CANCELLATIONS', label: 'Cancellations', order: 4, isMandatory: false,
      fields: [{ key: 'cancellations', label: 'Cancelled Bills', fieldType: 'TEXT', order: 0, isRequired: false }],
    },
    {
      key: 'EXCESS', label: 'Cash Reconciliation', order: 5, isMandatory: false,
      fields: [{ key: 'excessItems', label: 'Excess Items', fieldType: 'TEXT', order: 0, isRequired: false }],
    },
  ]

  for (const s of sections) {
    const section = await prisma.collectionSection.upsert({
      where: { stageId_key: { stageId: stage.id, key: s.key } },
      update: { label: s.label, order: s.order, isMandatory: s.isMandatory },
      create: { stageId: stage.id, key: s.key, label: s.label, order: s.order, isMandatory: s.isMandatory },
    })
    for (const f of s.fields) {
      await prisma.collectionField.upsert({
        where: { sectionId_key: { sectionId: section.id, key: f.key } },
        update: { label: f.label, fieldType: f.fieldType, order: f.order, isRequired: f.isRequired },
        create: { sectionId: section.id, key: f.key, label: f.label, fieldType: f.fieldType, order: f.order, isRequired: f.isRequired },
      })
    }
  }

  await prisma.collectionValidationRule.upsert({
    where: { id: `${template.id}-cash-not-exceed` },
    update: {},
    create: { id: `${template.id}-cash-not-exceed`, templateId: template.id, ruleType: 'CASH_NOT_EXCEED_SYSTEM_SALES', config: null },
  })

  for (const outletId of outletIds) {
    await prisma.outlet.update({ where: { id: outletId }, data: { companyId: company.id, defaultTemplateId: template.id } })
  }

  return { company, template }
}
