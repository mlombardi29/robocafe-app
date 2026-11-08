import { describe, expect, it } from "vitest";
import { adapterCoverage, parseWorkbook } from "./adapters";
import { csvLine } from "./csv";
import { buildEvidenceMaps } from "./evidence";
import {
  pinlessPeopleCsv,
  preexistingRecords,
  SYNTHETIC_CHECKLIST_KEYS,
  syntheticMappings,
  syntheticWorkbook,
} from "./fixtures";
import { mapLegacyRole } from "./mappings";
import { reconcileWorkbook } from "./reconcile";
import { NOT_A_LIVE_MIGRATION, rehearseImport, resolveMode, rollbackLastApply } from "./rehearse";
import { MigrateStore } from "./store";
import { LEGACY_HEADERS, LEGACY_TABS } from "./tabs";

describe("eleven-tab migration rehearsal kit", () => {
  it("covers all eleven Code.gs tabs with exact headers", () => {
    const coverage = adapterCoverage();
    expect(coverage.map((row) => row.tab)).toEqual([...LEGACY_TABS]);
    expect(coverage).toHaveLength(11);
    for (const row of coverage) {
      expect(row.headers).toEqual(LEGACY_HEADERS[row.tab]);
      expect(row.columns).toBe(LEGACY_HEADERS[row.tab].length);
    }
  });

  it("parses synthetic workbook with stable ids and explicit unresolved findings", () => {
    const parsed = parseWorkbook(syntheticWorkbook());
    expect(parsed.missingTabs).toEqual([]);
    expect(parsed.coveredTabs).toHaveLength(11);
    expect(parsed.tabs.People.rows.some((row) => row.legacyId === "person:alex tech")).toBe(true);
    expect(parsed.tabs.LocationSKUs.rows[0]?.legacyId).toBe("locsku:loc-sinai:sku-cups");
    expect(parsed.findings.some((f) => f.code === "pin_not_migrated")).toBe(true);
    expect(parsed.findings.some((f) => f.code === "secret_config_held")).toBe(true);
    expect(parsed.findings.some((f) => f.code === "unit_conversion_proposed")).toBe(true);
    expect(parsed.findings.some((f) => f.code === "negative_stock_delta")).toBe(true);
    expect(parsed.findings.some((f) => f.code === "fractional_stock_delta")).toBe(true);
    expect(parsed.findings.every((f) => f.ready === false)).toBe(true);
  });

  it("dry-run is default, fail-closed for live connection and unknown modes", () => {
    expect(resolveMode(undefined).mode).toBe("dry_run");
    expect(resolveMode("live").findings[0]?.code).toBe("live_mode_blocked");
    const store = new MigrateStore(preexistingRecords());
    const result = rehearseImport({
      csvByTab: syntheticWorkbook(),
      maps: syntheticMappings(),
      store,
      mode: "dry_run",
      connectionString: "postgresql://example.invalid/db",
    });
    expect(result.mode).toBe("dry_run");
    expect(result.writesApplied).toBe(0);
    expect(result.findings.some((f) => f.code === "live_mode_blocked")).toBe(true);
    expect(result.findings.some((f) => f.code === "write_blocked")).toBe(true);
    expect(result.caveat).toBe(NOT_A_LIVE_MIGRATION);
    expect(store.list("visit").filter((row) => !row.preexisting)).toHaveLength(0);
  });

  it("maps people/sites/skus/items and keeps unmapped keys unresolved", () => {
    const store = new MigrateStore();
    const result = rehearseImport({
      csvByTab: syntheticWorkbook(),
      maps: syntheticMappings(),
      store,
      mode: "dry_run",
    });
    expect(result.findings.some((f) => f.code === "unmapped_person" && /Unmapped Person/.test(f.detail))).toBe(true);
    expect(result.findings.some((f) => f.code === "unmapped_item_key" && /legacy_only_step/.test(f.detail))).toBe(true);
  });

  it("local_apply is idempotent on replay and preserves preexisting visits/payments", () => {
    const store = new MigrateStore(preexistingRecords());
    const maps = syntheticMappings();
    const csvByTab = syntheticWorkbook();

    const first = rehearseImport({ csvByTab, maps, store, mode: "local_apply" });
    expect(first.mode).toBe("local_apply");
    expect(first.inserted).toBeGreaterThan(0);
    expect(first.conflicts).toBeGreaterThanOrEqual(2);
    expect(first.findings.some((f) => f.code === "conflict_existing_visit")).toBe(true);
    expect(first.findings.some((f) => f.code === "conflict_existing_payment")).toBe(true);
    expect(store.get("visit", "visit-existing")?.preexisting).toBe(true);
    expect(store.get("visit", "visit-existing")?.payload).toEqual({
      note: "already in KioskOps",
      _tab: "ServiceSessions",
    });
    expect(store.get("payment", "pay-existing")?.payload).toEqual({
      note: "already paid in KioskOps",
      _tab: "Payments",
    });

    const beforeSecond = store.list().length;
    const second = rehearseImport({ csvByTab, maps, store, mode: "local_apply" });
    expect(second.inserted).toBe(0);
    expect(second.unchangedReplay).toBeGreaterThan(0);
    expect(store.list().length).toBe(beforeSecond);
  });

  it("rollback restores preexisting data after local_apply", () => {
    const store = new MigrateStore(preexistingRecords());
    rehearseImport({
      csvByTab: syntheticWorkbook(),
      maps: syntheticMappings(),
      store,
      mode: "local_apply",
    });
    expect(store.list().length).toBeGreaterThan(2);
    const rolled = rollbackLastApply(store);
    expect(rolled.ok).toBe(true);
    expect(store.list()).toHaveLength(2);
    expect(store.get("visit", "visit-existing")?.preexisting).toBe(true);
    expect(store.get("payment", "pay-existing")?.preexisting).toBe(true);
  });

  it("reconciliation surfaces stock/hours/payment mismatches without inventing fixes", () => {
    const store = new MigrateStore(preexistingRecords());
    const beforeApply = reconcileWorkbook(syntheticWorkbook(), store);
    expect(beforeApply.rowCounts.some((row) => row.tab === "ServiceSessions" && !row.match)).toBe(true);
    expect(beforeApply.rowCounts.some((row) => row.tab === "Payments" && !row.match)).toBe(true);

    rehearseImport({
      csvByTab: syntheticWorkbook(),
      maps: syntheticMappings(),
      store,
      mode: "local_apply",
    });
    const report = reconcileWorkbook(syntheticWorkbook(), store);
    expect(report.stockBySku.some((row) => row.negative)).toBe(true);
    expect(report.stockBySku.some((row) => row.fractional)).toBe(true);
    expect(report.mismatches.some((f) => f.code === "negative_stock_delta")).toBe(true);
    expect(report.mismatches.some((f) => f.code === "fractional_stock_delta")).toBe(true);
    expect(report.hoursByPerson.some((row) => row.person === "Alex Tech" && row.hoursFromCharges === 1)).toBe(true);
    expect(report.paymentTotal).toBeGreaterThan(0);
    expect(report.chargeTotal).toBe(25);
  });

  it("header mismatch fails closed for a tab without inventing an adapter shape", () => {
    const bad = {
      ...syntheticWorkbook(),
      SKUs: "wrong,header\n1,2\n",
    };
    const parsed = parseWorkbook(bad);
    expect(parsed.tabs.SKUs.findings[0]?.code).toBe("header_mismatch");
    expect(parsed.tabs.SKUs.rows).toHaveLength(0);
  });

  it("accepts PIN-less People headers and never imports PIN values", () => {
    const parsed = parseWorkbook({ ...syntheticWorkbook(), People: pinlessPeopleCsv() });
    expect(parsed.tabs.People.findings.some((f) => f.code === "header_mismatch")).toBe(false);
    expect(parsed.tabs.People.rows).toHaveLength(2);
    expect(parsed.tabs.People.rows.every((row) => row.fields.pin === "")).toBe(true);
    expect(parsed.tabs.People.findings.some((f) => f.code === "pin_not_migrated")).toBe(false);
    expect(mapLegacyRole("technician")).toEqual({ role: "tech" });
    expect(mapLegacyRole("manager")).toEqual({ role: "admin" });
  });

  it("understands legacy completion itemId/label JSON and only exact checklist keys", () => {
    const store = new MigrateStore();
    const result = rehearseImport({
      csvByTab: syntheticWorkbook(),
      maps: syntheticMappings(),
      store,
      mode: "dry_run",
    });
    expect(result.findings.some((f) => f.code === "unmapped_item_key" && /legacy_only_step/.test(f.detail))).toBe(
      true,
    );
    const visit = result.findings.find((f) => f.tab === "ServiceSessions" && f.legacyId === "visit-legacy-1");
    expect(visit).toBeTruthy();
  });

  it("builds evidence maps only from clear workbook provenance", () => {
    const base = syntheticWorkbook();
    const workbook = {
      ...base,
      Transactions: `${base.Transactions}\ntx-blank,2026-01-05T12:00:00Z,adjust,sku-cups,Sample cups,1,1,sleeve,Alex Tech,tech,,`,
      ServiceSessions: [
        LEGACY_HEADERS.ServiceSessions.join(","),
        csvLine([
          "visit-a",
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
            { itemId: "powder_clean", label: "Powder", completed: true },
            { itemId: "milk_clean", label: "Milk", completed: true },
          ]),
          "2026-01-06",
          "10:00",
          "11:00",
          "FALSE",
          "FALSE",
          "",
          "2026-01-06T11:01:00Z",
          "[]",
        ]),
        csvLine([
          "visit-b",
          "loc-sinai",
          "Sample Sinai",
          "s35",
          "1",
          "Alex Tech",
          "2026-01-07T10:00:00Z",
          "2026-01-07T11:00:00Z",
          "complete",
          "100",
          "0",
          "",
          "",
          "[]",
          "2026-01-07",
          "10:00",
          "11:00",
          "FALSE",
          "FALSE",
          "",
          "2026-01-07T11:01:00Z",
          "[]",
        ]),
        csvLine([
          "visit-c",
          "loc-sinai",
          "Almost Sinai",
          "s35",
          "1",
          "Alex Tech",
          "2026-01-08T10:00:00Z",
          "2026-01-08T11:00:00Z",
          "complete",
          "100",
          "0",
          "",
          "",
          "[]",
          "2026-01-08",
          "10:00",
          "11:00",
          "FALSE",
          "FALSE",
          "",
          "2026-01-08T11:01:00Z",
          "[]",
        ]),
      ].join("\n"),
      People: pinlessPeopleCsv(),
    };
    const parsed = parseWorkbook(workbook);
    const evidence = buildEvidenceMaps(parsed.tabs, SYNTHETIC_CHECKLIST_KEYS);
    expect(evidence.maps.peopleByName["alex tech"]).toBe("person:alex tech");
    expect(evidence.maps.sitesByLegacyId["loc-sinai"]).toBe("loc-sinai");
    expect(evidence.maps.skusByLegacyId["sku-cups"]).toBe("sku-cups");
    expect(evidence.maps.itemKeys.powder_clean).toBe("powder_clean");
    expect(evidence.maps.itemKeys.milk_clean).toBeUndefined();
    expect(evidence.findings.some((f) => f.code === "ambiguous_match" && /Almost Sinai/.test(f.detail))).toBe(true);

    const result = rehearseImport({
      csvByTab: workbook,
      maps: evidence.maps,
      store: new MigrateStore(),
      mode: "dry_run",
    });
    expect(result.findings.some((f) => f.code === "missing_source_ref")).toBe(true);
    expect(result.writesApplied).toBe(0);
  });
});
