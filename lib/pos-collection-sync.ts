// Stub for the POS_SYNC entry mode. Today, "System Sales" on every
// collection form is a manually typed figure representing what the POS/till
// says a staff member sold — there is no live POS integration to read it
// from automatically. This module is the seam for wiring one up later: a
// stage whose entryMode is POS_SYNC would call fetchPosTotals() to
// pre-populate field values instead of requiring manual entry, once a real
// POS system is available to connect to.

export interface PosSyncResult {
  staffId: string
  values: Record<string, string> // fieldKey -> value, matched to the stage's fields by key
}

/** Not implemented — no POS integration exists yet. Always returns empty. */
export async function fetchPosTotals(_stageId: string, _date: Date): Promise<PosSyncResult[]> {
  return []
}

export function isPosSyncConfigured(): boolean {
  return false
}
