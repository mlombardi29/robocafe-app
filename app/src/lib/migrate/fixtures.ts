import { csvLine } from "./csv";
import { LEGACY_HEADERS, type LegacyTab } from "./tabs";
import type { ExistingRecord, MappingTables } from "./types";
import type { WorkbookCsv } from "./adapters";

function tabCsv(tab: LegacyTab, rows: string[][]): string {
  return [LEGACY_HEADERS[tab].join(","), ...rows.map(csvLine)].join("\n");
}

/** Synthetic workbook only. No real personnel, phones, emails, codes, or catalogue exports. */
export function syntheticWorkbook(): WorkbookCsv {
  return {
    SKUs: tabCsv("SKUs", [
      ["sku-cups", "Sample cups", "TRUE", "sleeve", "50 cups", "box", "20", "Sample Supply", "5", "", "", "", "", "20", ""],
      ["sku-spice", "Sample spice", "TRUE", "bottle", "1 L", "pack", "6", "Unsure", "5", "", "", "", "", "3", ""],
      ["sku-frac", "Sample disposable", "TRUE", "box", "500", "box", "1", "Sample Shop", "2", "", "", "", "", "2", ""],
    ]),
    Transactions: tabCsv("Transactions", [
      ["tx-1", "2026-01-02T12:00:00Z", "receive", "sku-cups", "Sample cups", "2", "2", "sleeve", "Alex Tech", "tech", "loc-sinai", ""],
      ["tx-2", "2026-01-03T12:00:00Z", "adjust", "sku-spice", "Sample spice", "-4", "4", "bottle", "Alex Tech", "tech", "loc-sinai", ""],
      ["tx-3", "2026-01-04T12:00:00Z", "adjust", "sku-frac", "Sample disposable", "1.5", "1.5", "box", "Alex Tech", "tech", "loc-uoft", ""],
    ]),
    Locations: tabCsv("Locations", [
      ["loc-sinai", "Sample Sinai", "s35", "TRUE"],
      ["loc-uoft", "Sample UofT", "s22", "TRUE"],
    ]),
    LocationSKUs: tabCsv("LocationSKUs", [
      ["loc-sinai", "sku-cups", "TRUE"],
      ["loc-uoft", "sku-frac", "TRUE"],
    ]),
    KioskFlags: tabCsv("KioskFlags", [
      ["flag-1", "2026-01-05T12:00:00Z", "loc-sinai", "Sample Sinai", "sku-cups", "Sample cups", "low", "Alex Tech", "note", "FALSE", "", ""],
    ]),
    People: tabCsv("People", [
      ["Alex Tech", "technician", "TRUE", ""],
      ["Casey Manager", "manager", "TRUE", "9999"],
      ["Unmapped Person", "tech", "TRUE", ""],
    ]),
    Config: tabCsv("Config", [
      ["app.homeUrl", "https://example.invalid/app"],
      ["secret.token", "SHOULD_NOT_IMPORT"],
    ]),
    ServiceSessions: tabCsv("ServiceSessions", [
      [
        "visit-legacy-1",
        "loc-sinai",
        "Sample Sinai",
        "s35",
        "1",
        "Alex Tech",
        "2026-01-06T10:00:00Z",
        "2026-01-06T11:00:00Z",
        "complete",
        "100",
        "0",
        "",
        "",
        JSON.stringify([
          { key: "gloves", state: "done" },
          { itemId: "powder_clean", label: "Clean powder", completed: true },
          { itemId: "legacy_only_step", label: "Old step", completed: true },
        ]),
        "2026-01-06",
        "10:00",
        "11:00",
        "FALSE",
        "FALSE",
        "",
        "2026-01-06T11:01:00Z",
        "[]",
      ],
      [
        "visit-existing",
        "loc-uoft",
        "Sample UofT",
        "s22",
        "1",
        "Alex Tech",
        "2026-01-07T10:00:00Z",
        "2026-01-07T11:00:00Z",
        "complete",
        "100",
        "0",
        "",
        "from sheet",
        "[]",
        "2026-01-07",
        "10:00",
        "11:00",
        "FALSE",
        "FALSE",
        "",
        "2026-01-07T11:01:00Z",
        "[]",
      ],
    ]),
    ScheduleOverrides: tabCsv("ScheduleOverrides", [
      ["2026-01-08", "loc-sinai", "TRUE", "Casey Manager", "Alex Tech", "Alex Tech", "coverage", "2026-01-08T09:00:00Z"],
    ]),
    Payments: tabCsv("Payments", [
      ["pay-legacy-1", "Alex Tech", "2026-01-01", "2026-01-15", "2026-01-16", "ok", "FALSE", "2026-01-16T12:00:00Z"],
      ["pay-existing", "Alex Tech", "2025-12-01", "2025-12-15", "2025-12-16", "sheet copy", "FALSE", "2025-12-16T12:00:00Z"],
    ]),
    Charges: tabCsv("Charges", [
      [
        "chg-1",
        "Alex Tech",
        "hours",
        "2026-01-06",
        "service",
        "25",
        "10:00",
        "11:00",
        "1",
        "",
        "TRUE",
        "2026-01-16",
        "",
        "FALSE",
        "2026-01-16T12:00:00Z",
      ],
    ]),
  };
}

export function syntheticMappings(): MappingTables {
  return {
    peopleByName: {
      "alex tech": "person-alex",
      "casey manager": "person-casey",
    },
    sitesByLegacyId: {
      "loc-sinai": "site-sinai",
      "loc-uoft": "site-uoft",
    },
    sitesByName: {
      "sample sinai": "site-sinai",
      "sample uoft": "site-uoft",
    },
    skusByLegacyId: {
      "sku-cups": "sku-1",
      "sku-spice": "sku-2",
      "sku-frac": "sku-3",
    },
    itemKeys: {
      gloves: "gloves",
      powder_clean: "powder_clean",
    },
  };
}

/** PIN-less People header (production sanitized export shape). */
export function pinlessPeopleCsv(): string {
  return ["name,role,active", "Alex Tech,technician,true", "Casey Manager,manager,true"].join("\n");
}

/** Checklist keys the evidence builder may exact-match (synthetic + current overlap). */
export const SYNTHETIC_CHECKLIST_KEYS = [
  "gloves",
  "powder_clean",
  "powder_fill",
  "syrup",
  "test_drink",
  "kc_consumables",
  "claw",
  "wipe_cameo",
  "fill_beans",
  "empty_pucks",
  "milk_bag",
  "grey_water",
  "scale_check",
  "cups_lids",
  "start_milk_clean",
];

/** Preexisting KioskOps visit + payment that must not be overwritten. */
export function preexistingRecords(): ExistingRecord[] {
  return [
    {
      kind: "visit",
      legacyId: "visit-existing",
      fingerprint: "preexisting-visit-fingerprint",
      preexisting: true,
      payload: { note: "already in KioskOps", _tab: "ServiceSessions" },
    },
    {
      kind: "payment",
      legacyId: "pay-existing",
      fingerprint: "preexisting-payment-fingerprint",
      preexisting: true,
      payload: { note: "already paid in KioskOps", _tab: "Payments" },
    },
  ];
}
