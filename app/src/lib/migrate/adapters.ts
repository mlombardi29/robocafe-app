import { parseCsv } from "./csv";
import { LEGACY_HEADERS, LEGACY_TABS, type LegacyTab } from "./tabs";
import type { Finding, ParsedRow, TabParseResult } from "./types";

function finding(
  tab: LegacyTab,
  legacyId: string,
  code: Finding["code"],
  detail: string,
): Finding {
  return { tab, legacyId, code, detail, ready: false };
}

function numberOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Propose sleeve→cup/lid factors. Never apply or invent other corrections. */
export function proposedUnitConversion(
  baseUnit: string,
  note: string,
): { unit: string; factor: number; detail: string } | null {
  const unit = baseUnit.trim().toLowerCase();
  const text = note.toLowerCase();
  if (unit === "sleeve" && /50\s*cups/.test(text)) {
    return {
      unit: "cup",
      factor: 50,
      detail: "Historical sleeve counts would convert to cups at 50 per sleeve. Not applied.",
    };
  }
  if (unit === "sleeve" && /100\s*lids/.test(text)) {
    return {
      unit: "lid",
      factor: 100,
      detail: "Historical sleeve counts would convert to lids at 100 per sleeve. Not applied.",
    };
  }
  return null;
}

function stableIdFor(tab: LegacyTab, fields: Record<string, string>): string {
  if (tab === "People") {
    const name = fields.name?.trim() ?? "";
    return name ? `person:${name.toLowerCase()}` : "";
  }
  if (tab === "Config") {
    const key = fields.key?.trim() ?? "";
    return key ? `config:${key}` : "";
  }
  if (tab === "LocationSKUs") {
    const locationId = fields.locationId?.trim() ?? "";
    const skuId = fields.skuId?.trim() ?? "";
    return locationId && skuId ? `locsku:${locationId}:${skuId}` : "";
  }
  if (tab === "ScheduleOverrides") {
    const date = fields.date?.trim() ?? "";
    const kioskId = fields.kioskId?.trim() ?? "";
    return date && kioskId ? `sched:${date}:${kioskId}` : "";
  }
  return fields.id?.trim() ?? "";
}

function parseTabCsv(tab: LegacyTab, csv: string): TabParseResult {
  const want = LEGACY_HEADERS[tab];
  const table = parseCsv(csv.trim());
  const header = table[0] ?? [];
  const findings: Finding[] = [];
  if (header.length !== want.length || header.some((cell, index) => cell !== want[index])) {
    return {
      tab,
      rows: [],
      findings: [
        finding(
          tab,
          "",
          "header_mismatch",
          `Expected ${want.join(",")}. Got ${header.join(",") || "(empty)"}. Nothing was read.`,
        ),
      ],
      accepted: 0,
      held: 1,
    };
  }

  const rows: ParsedRow[] = [];
  let accepted = 0;
  let held = 0;
  table.slice(1).forEach((cells) => {
    const fields: Record<string, string> = {};
    want.forEach((name, col) => {
      fields[name] = cells[col] ?? "";
    });
    const rowFindings: Finding[] = [];
    if (cells.length !== want.length) {
      rowFindings.push(
        finding(
          tab,
          cells[0]?.trim() ?? "",
          "ambiguous_columns",
          `Row has ${cells.length} fields; header has ${want.length}. Held unresolved.`,
        ),
      );
    }
    const legacyId = stableIdFor(tab, fields);
    if (!legacyId) {
      rowFindings.push(
        finding(tab, "", "missing_stable_id", "No stable legacy id could be formed. Held unresolved."),
      );
    }
    if (tab === "People" && (fields.pin?.trim() ?? "") !== "") {
      rowFindings.push(
        finding(
          tab,
          legacyId || fields.name || "",
          "pin_not_migrated",
          "PIN column is present in the export. PINs are never migrated; temp PINs are issued only at an approved cutover.",
        ),
      );
      fields.pin = "";
    }
    if (tab === "Config") {
      const key = (fields.key ?? "").toLowerCase();
      if (/(secret|token|password|api[_-]?key|service.?role|private)/i.test(key) || fields.value.trim().length > 80) {
        rowFindings.push(
          finding(
            tab,
            legacyId || fields.key || "",
            "secret_config_held",
            "Config value looks sensitive or oversized. Held unresolved; not staged as ready.",
          ),
        );
      }
    }
    if (tab === "SKUs") {
      const conversion = proposedUnitConversion(fields.baseUnit ?? "", fields.baseUnitNote ?? "");
      if (conversion) {
        rowFindings.push(finding(tab, legacyId, "unit_conversion_proposed", conversion.detail));
      }
    }
    if (tab === "Transactions") {
      const delta = numberOrNull(fields.delta);
      if (delta != null && delta < 0) {
        rowFindings.push(
          finding(
            tab,
            legacyId,
            "negative_stock_delta",
            `Delta ${delta} left as-is. Not clamped.`,
          ),
        );
      }
      if (delta != null && !Number.isInteger(delta)) {
        rowFindings.push(
          finding(
            tab,
            legacyId,
            "fractional_stock_delta",
            `Delta ${delta} is fractional. Not remapped or rounded.`,
          ),
        );
      }
    }

    const heldRow = rowFindings.some((f) =>
      ["ambiguous_columns", "missing_stable_id", "secret_config_held"].includes(f.code),
    );
    if (heldRow) held += 1;
    else accepted += 1;
    findings.push(...rowFindings);
    rows.push({ tab, legacyId, fields, findings: rowFindings });
  });

  return { tab, rows, findings, accepted, held };
}

export type WorkbookCsv = Partial<Record<LegacyTab, string>>;

export function parseWorkbook(csvByTab: WorkbookCsv): {
  tabs: Record<LegacyTab, TabParseResult>;
  findings: Finding[];
  coveredTabs: LegacyTab[];
  missingTabs: LegacyTab[];
} {
  const tabs = {} as Record<LegacyTab, TabParseResult>;
  const findings: Finding[] = [];
  const coveredTabs: LegacyTab[] = [];
  const missingTabs: LegacyTab[] = [];
  for (const tab of LEGACY_TABS) {
    const csv = csvByTab[tab];
    if (csv == null) {
      missingTabs.push(tab);
      findings.push({
        tab,
        legacyId: "",
        code: "unresolved",
        detail: "CSV for this tab was not supplied. Adapter exists; input missing.",
        ready: false,
      });
      tabs[tab] = { tab, rows: [], findings: [], accepted: 0, held: 0 };
      continue;
    }
    coveredTabs.push(tab);
    const parsed = parseTabCsv(tab, csv);
    tabs[tab] = parsed;
    findings.push(...parsed.findings);
  }
  return { tabs, findings, coveredTabs, missingTabs };
}

export function adapterCoverage(): { tab: LegacyTab; columns: number; headers: readonly string[] }[] {
  return LEGACY_TABS.map((tab) => ({ tab, columns: LEGACY_HEADERS[tab].length, headers: LEGACY_HEADERS[tab] }));
}
