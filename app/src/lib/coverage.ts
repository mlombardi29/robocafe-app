/** Coverage request helpers. No email/send side effects. */

export type CoverageRow = {
  id: string;
  site_id: string;
  service_date: string;
  coverage_requested: boolean;
  requested_by: string | null;
  claimed_by: string | null;
  note: string | null;
};

/** Open requests for today or future only. Past dates stay in history but off the open list. */
export function openCoverage(rows: CoverageRow[], today: string): CoverageRow[] {
  return rows
    .filter((row) => row.coverage_requested && row.service_date >= today)
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.site_id.localeCompare(b.site_id));
}

export function coverageLabel(row: CoverageRow, personId: string | null): string {
  if (row.coverage_requested) {
    if (personId && row.requested_by === personId) return "Coverage requested ✓";
    return "Coverage needed";
  }
  if (row.claimed_by) return "Coverage claimed";
  return "No coverage request";
}

export function canCancelCoverage(row: CoverageRow, personId: string | null, admin: boolean): boolean {
  if (!row.coverage_requested) return false;
  if (admin) return true;
  return Boolean(personId && row.requested_by === personId);
}

export function canClaimCoverage(row: CoverageRow, personId: string | null): boolean {
  if (!row.coverage_requested || !personId) return false;
  return row.requested_by !== personId;
}
