/** Reimbursement charge helpers. Receipt URL is optional text until Drive is activated. */

import { torontoNow } from "./dates";

export type ChargeRow = {
  id: string;
  person_id: string;
  site_id: string | null;
  amount: number | null;
  note: string | null;
  receipt_url: string | null;
  paid: boolean;
  voided?: boolean;
  created_at?: string;
  edited_at?: string | null;
  edited_by?: string | null;
};

export function parseChargeAmount(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Accept blank (Drive later) or a non-empty trimmed string. Do not invent a Drive file. */
export function normalizeReceiptUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function unpaidCharges(rows: ChargeRow[]): ChargeRow[] {
  return rows
    .filter((row) => !row.paid && !row.voided)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `$${Number(amount).toFixed(2)}`;
}

/** Same Toronto calendar day as created_at (before local midnight). */
export function chargeSameTorontoDay(createdAt: string, now = new Date()): boolean {
  return torontoNow(new Date(createdAt)).today === torontoNow(now).today;
}

/**
 * Tech may edit own unpaid, non-voided charge until end of the Toronto day it was logged.
 * Admin may edit any non-voided charge (paid included — UI warns).
 */
export function chargeEditAccess(input: {
  charge: Pick<ChargeRow, "person_id" | "paid" | "voided" | "created_at">;
  viewerPersonId: string | null | undefined;
  isAdmin: boolean;
  now?: Date;
}): { canEdit: boolean; reason: "ok" | "voided" | "locked" | "not-owner" | "paid" } {
  const { charge, viewerPersonId, isAdmin } = input;
  if (charge.voided) return { canEdit: false, reason: "voided" };
  if (isAdmin) return { canEdit: true, reason: "ok" };
  if (!viewerPersonId || charge.person_id !== viewerPersonId) return { canEdit: false, reason: "not-owner" };
  if (charge.paid) return { canEdit: false, reason: "paid" };
  if (!charge.created_at || !chargeSameTorontoDay(charge.created_at, input.now)) {
    return { canEdit: false, reason: "locked" };
  }
  return { canEdit: true, reason: "ok" };
}

export function chargeEditLockedLabel(reason: ReturnType<typeof chargeEditAccess>["reason"]): string | null {
  if (reason === "ok") return null;
  if (reason === "voided") return "Voided";
  return "Ask an admin to change this";
}
