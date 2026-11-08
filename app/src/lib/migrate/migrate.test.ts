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
import {
  applyAddCandidates,
  createLocalSnapshotState,
  idempotentReplay,
  injectConflict,
  preexistingFingerprints,
  undoLastBatch,
} from "./localSnapshot";
import { applyMappings, mapLegacyRole } from "./mappings";
import { reconcileWorkbook } from "./reconcile";
import { NOT_A_LIVE_MIGRATION, rehearseImport, resolveMode, rollbackLastApply } from "./rehearse";
import { interpretLegacyStep, listClearEquivalences } from "./stepEquivalence";
import { MigrateStore } from "./store";
import { LEGACY_HEADERS, LEGACY_TABS } from "./tabs";
import { buildTransferPreview } from "./transferPreview";

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

  it("maps only clear step equivalents and preserves original completion payloads", () => {
    expect(interpretLegacyStep("bb_hands").currentKey).toBe("gloves");
    expect(interpretLegacyStep("milk_clean").kind).toBe("history_only");
    expect(interpretLegacyStep("syrup_clean").kind).toBe("history_only");
    expect(interpretLegacyStep("cups_fill").kind).toBe("history_only");
    expect(interpretLegacyStep("arm_setup").kind).toBe("history_only");
    expect(listClearEquivalences().every((row) => row.kind === "equivalent" && row.currentKey)).toBe(true);

    const parsed = parseWorkbook(syntheticWorkbook());
    const evidence = buildEvidenceMaps(parsed.tabs, SYNTHETIC_CHECKLIST_KEYS);
    const mapped = applyMappings(parsed.tabs.ServiceSessions.rows, evidence.maps);
    const visit = mapped.rows.find((row) => row.legacyId === "visit-legacy-1");
    expect(visit).toBeTruthy();
    const items = JSON.parse(visit!.fields.completionsMappedJson || "[]") as Array<Record<string, unknown>>;
    const powder = items.find((item) => item.legacy_item_key === "powder_clean" || item.itemId === "powder_clean");
    expect(powder?.interpretation).toBe("equivalent");
    expect(powder?.current_key).toBe("powder_clean");
    expect(powder?.transfer_ready).toBe(false);
    expect(powder?.label).toBe("Clean powder");
    expect(powder?.completed).toBe(true);
    const legacyOnly = items.find((item) => item.legacy_item_key === "legacy_only_step");
    expect(legacyOnly?.interpretation).toBe("history_only");
    expect(legacyOnly?.current_key).toBeNull();
    expect(legacyOnly?.transfer_ready).toBe(false);

    const again = applyMappings(parsed.tabs.ServiceSessions.rows, evidence.maps);
    expect(again.rows[0]?.fields.completionsMappedJson).toBe(mapped.rows[0]?.fields.completionsMappedJson);
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

  it("classifies transfer preview and protects preexisting rows on local replay/undo", () => {
    const parsed = parseWorkbook(syntheticWorkbook());
    const current = {
      people: [{ id: "cur-person", goes_by: "Alex", role: "tech", active: true, legacy_id: null }],
      sites: [{ id: "cur-site", name: "Sample Sinai", is_sandbox: false, legacy_id: null }],
      visits: [
        {
          id: "cur-visit",
          legacy_id: null,
          site_id: "cur-site",
          person_id: "cur-person",
          is_sandbox: false,
          status: "completed",
          service_date: "2026-11-05",
        },
      ],
      skus: [] as Array<Record<string, unknown>>,
      payments: [] as Array<Record<string, unknown>>,
      charges: [] as Array<Record<string, unknown>>,
    };
    const comparison = {
      entity_candidates: {
        people: [
          {
            legacy_name: "Alex Tech",
            current_candidates: [{ id: "cur-person", name: "Alex" }],
            confidence: "Unique exact normalized name/alias candidate, identity not proven",
          },
          { legacy_name: "Unmapped Person", current_candidates: [], confidence: "No exact name/alias candidate" },
        ],
      },
      site_alias_candidates: [
        {
          legacy_id: "loc-sinai",
          legacy_name: "Sample Sinai",
          current_id: "cur-site",
          current_name: "Sample Sinai",
          evidence: "exact normalized name",
          status: "candidate, not independently confirmed identity",
        },
      ],
      legacy_duplicate_candidate_detail: [
        { legacy_ids: ["visit-existing"], source_rows: [1], all_other_source_fields_identical: false, note: "repeat" },
      ],
      legacy_person_unmatched_visits: [{ name: "Unmapped Person", visits: 1 }],
      unmatched_person_access_status: {
        conclusion: "No matching current person found. Do not infer former/offboarded status.",
      },
    };
    const preview = buildTransferPreview({ tabs: parsed.tabs, current, comparison });
    expect(preview.limitation).toContain("in-memory JSON");
    expect(preview.keepCurrent.some((row) => row.currentId === "cur-visit")).toBe(true);
    expect(preview.reviewQueue.some((row) => row.legacyId === "visit-existing")).toBe(true);
    expect(preview.addCandidates.some((row) => row.tab === "ServiceSessions" && row.legacyId === "visit-legacy-1")).toBe(
      true,
    );
    expect(preview.reviewQueue.some((row) => /Unmapped Person|historical identity/i.test(row.reason))).toBe(true);
    expect(preview.reconciliation.every((row) => row.ok)).toBe(true);

    const local = createLocalSnapshotState(current, "batch-test");
    const before = preexistingFingerprints(local);
    const first = applyAddCandidates(local, preview.addCandidates);
    expect(first.inserted).toBeGreaterThan(0);
    const replay = idempotentReplay(local, preview.addCandidates);
    expect(replay.inserted).toBe(0);
    expect(replay.unchanged).toBeGreaterThan(0);
    injectConflict(local, "visits", "visit-legacy-1", { id: "preexisting-hijack", legacy_id: "visit-legacy-1" });
    // conflict path: mark that legacy id preexisting then attempt apply on fresh state
    const conflictState = createLocalSnapshotState(current, "batch-conflict");
    injectConflict(conflictState, "visits", "visit-legacy-1", {
      id: "already-there",
      legacy_id: "visit-legacy-1",
      note: "preexisting",
    });
    const conflicted = applyAddCandidates(conflictState, preview.addCandidates);
    expect(conflicted.conflicts).toBeGreaterThan(0);
    expect(conflictState.records.get("visits:visit-legacy-1")?.payload.note).toBe("preexisting");

    const undone = undoLastBatch(local);
    expect(undone.ok).toBe(true);
    expect(preexistingFingerprints(local)).toEqual(before);
  });
});
