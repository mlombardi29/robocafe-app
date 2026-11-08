import type { WorkbookCsv } from "./adapters";
import { parseWorkbook } from "./adapters";
import { MigrateStore } from "./store";
import { LEGACY_TABS, type LegacyTab } from "./tabs";
import type { Finding, ReconciliationReport } from "./types";

function numberOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function reconcileWorkbook(
  csvByTab: WorkbookCsv,
  store: MigrateStore,
): ReconciliationReport {
  const parsed = parseWorkbook(csvByTab);
  const mismatches: Finding[] = [];

  const rowCounts = LEGACY_TABS.map((tab) => {
    const source = parsed.tabs[tab].rows.filter((row) => row.legacyId).length;
    let inStore = 0;
    if (tab === "ServiceSessions") inStore = store.list("visit").length;
    else if (tab === "Payments") inStore = store.list("payment").length;
    else if (tab === "Charges") inStore = store.list("charge").length;
    else {
      inStore = store
        .list("other")
        .filter((row) => (row.payload._tab as string | undefined) === tab).length;
    }
    const match = source === inStore;
    if (!match) {
      mismatches.push({
        tab,
        legacyId: "",
        code: "unresolved",
        detail: `Rowcount mismatch: source ${source}, store ${inStore}. Not forced equal.`,
        ready: false,
      });
    }
    return { tab, source, inStore, match };
  });

  const stockMap = new Map<string, number>();
  for (const row of parsed.tabs.Transactions.rows) {
    const sku = row.fields.skuId?.trim() || row.fields.skuName?.trim() || "";
    if (!sku) continue;
    const delta = numberOrNull(row.fields.delta);
    if (delta == null) {
      mismatches.push({
        tab: "Transactions",
        legacyId: row.legacyId,
        code: "unresolved",
        detail: "Transaction delta missing or not numeric. Omitted from stock sum.",
        ready: false,
      });
      continue;
    }
    stockMap.set(sku, (stockMap.get(sku) ?? 0) + delta);
  }
  const stockBySku = [...stockMap.entries()].map(([skuLegacyId, deltaSum]) => {
    const fractional = !Number.isInteger(deltaSum);
    const negative = deltaSum < 0;
    let note = "Sum of legacy transaction deltas only. Not a physical count and not reconciled to on-hand stock.";
    if (fractional) {
      note += " Fractional total left unresolved; not rounded.";
      mismatches.push({
        tab: "Transactions",
        legacyId: skuLegacyId,
        code: "fractional_stock_delta",
        detail: `SKU ${skuLegacyId} delta sum ${deltaSum} is fractional.`,
        ready: false,
      });
    }
    if (negative) {
      note += " Negative total left as-is; not clamped.";
      mismatches.push({
        tab: "Transactions",
        legacyId: skuLegacyId,
        code: "negative_stock_delta",
        detail: `SKU ${skuLegacyId} delta sum ${deltaSum} is negative.`,
        ready: false,
      });
    }
    return { skuLegacyId, deltaSum, fractional, negative, note };
  });

  const hoursMap = new Map<string, { hours: number; sessions: number }>();
  for (const row of parsed.tabs.Charges.rows) {
    const person = row.fields.personName?.trim() || "(unmapped)";
    const hours = numberOrNull(row.fields.hours) ?? 0;
    const cur = hoursMap.get(person) ?? { hours: 0, sessions: 0 };
    cur.hours += hours;
    hoursMap.set(person, cur);
  }
  for (const row of parsed.tabs.ServiceSessions.rows) {
    const person = row.fields.technicianName?.trim() || "(unmapped)";
    const cur = hoursMap.get(person) ?? { hours: 0, sessions: 0 };
    cur.sessions += 1;
    hoursMap.set(person, cur);
  }
  const hoursByPerson = [...hoursMap.entries()].map(([person, value]) => ({
    person,
    hoursFromCharges: value.hours,
    sessionsCounted: value.sessions,
  }));

  let paymentTotal = 0;
  let chargeTotal = 0;
  // Payments have no amount column in legacy headers; count non-void rows as presence only.
  const paymentsNonVoid = parsed.tabs.Payments.rows.filter(
    (row) => row.fields.voided?.trim().toUpperCase() !== "TRUE",
  ).length;
  paymentTotal = paymentsNonVoid;
  for (const row of parsed.tabs.Charges.rows) {
    if (row.fields.voided?.trim().toUpperCase() === "TRUE") continue;
    chargeTotal += numberOrNull(row.fields.amount) ?? 0;
  }

  return {
    rowCounts,
    stockBySku,
    hoursByPerson,
    paymentTotal,
    chargeTotal,
    mismatches,
  };
}

export function emptyCsvByTab(): Record<LegacyTab, string> {
  const out = {} as Record<LegacyTab, string>;
  for (const tab of LEGACY_TABS) out[tab] = "";
  return out;
}
