/**
 * Per-trip pay. Warehouse pickup and milk run are flat rates copied onto the
 * row at log time. A milk run can name several sites and still pays once.
 * One non-voided warehouse pickup and one non-voided milk run per
 * technician per Toronto day. A voided row frees that kind's slot.
 */

import { chargeSameTorontoDay } from "./charges";

export const TRIP_PAY_EFFECTIVE_ON = "2026-11-25";
export const DEFAULT_WAREHOUSE_PICKUP_RATE = 12;
export const DEFAULT_MILK_RUN_RATE = 10;

export type TripKind = "warehouse_pickup" | "milk_run";

export type TripDraft = {
  kind: TripKind;
  tripOn: string;
  siteIds: string[];
  note: string;
  milkCost: string;
  receiptAttested: boolean;
  today: string;
  effectiveOn?: string;
};

export function duplicateKindMessage(kind: TripKind): string {
  return kind === "milk_run"
    ? "You already logged a milk run for this day."
    : "You already logged a warehouse pickup for this day.";
}

/** True when a non-voided trip of this kind is already on that day. */
export function sameDayKindTaken(
  existing: { kind: TripKind; date: string; voided?: boolean }[],
  kind: TripKind,
  day: string,
): boolean {
  return existing.some((row) => !row.voided && row.kind === kind && row.date === day);
}

/** Flat pay for one logged trip. Site count never multiplies it. */
export function flatTripAmount(kind: TripKind, rate: number, siteCount: number): number {
  if (kind === "milk_run" && siteCount < 1) {
    throw new Error("A milk run needs at least one site.");
  }
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Math.round(rate * 100) / 100;
}

export function tripKindLabel(kind: TripKind): string {
  return kind === "milk_run" ? "Milk run" : "Warehouse pickup";
}

export function tripSitesLabel(sites: string[]): string {
  return sites.map((site) => site.trim()).filter(Boolean).join(", ");
}

export function validateTripDraft(input: TripDraft): string | null {
  const effective = input.effectiveOn || TRIP_PAY_EFFECTIVE_ON;
  const sites = [...new Set(input.siteIds.filter(Boolean))];
  if (input.tripOn < effective) return `Trip pay starts on ${effective}. Earlier days are not trips.`;
  if (input.tripOn > input.today) return "A trip cannot be logged for a future day.";
  if (input.kind === "milk_run") {
    if (sites.length < 1) return "A milk run needs at least one site.";
    const cost = Number(input.milkCost.trim());
    if (!Number.isFinite(cost) || cost <= 0) return "Enter the milk cost.";
    if (!input.receiptAttested) return "Confirm you have the receipt and will hand it in.";
    return null;
  }
  if (sites.length > 0) return "A warehouse pickup does not use a site.";
  return null;
}

export function tripPayLocked(paymentStatus: string | null | undefined): boolean {
  return paymentStatus === "paid";
}

/**
 * Same-day self-edit as charges. A paid week locks the trip.
 * A voided trip stays voided.
 */
export function tripEditAccess(input: {
  trip: { person_id: string; voided?: boolean; created_at?: string; paymentStatus?: string | null };
  viewerPersonId: string | null | undefined;
  isAdmin: boolean;
  now?: Date;
}): { canEdit: boolean; reason: "ok" | "voided" | "paid" | "locked" | "not-owner" } {
  const { trip, viewerPersonId, isAdmin } = input;
  if (trip.voided) return { canEdit: false, reason: "voided" };
  if (tripPayLocked(trip.paymentStatus)) return { canEdit: false, reason: "paid" };
  if (isAdmin) return { canEdit: true, reason: "ok" };
  if (!viewerPersonId || trip.person_id !== viewerPersonId) return { canEdit: false, reason: "not-owner" };
  if (!trip.created_at || !chargeSameTorontoDay(trip.created_at, input.now)) {
    return { canEdit: false, reason: "locked" };
  }
  return { canEdit: true, reason: "ok" };
}
