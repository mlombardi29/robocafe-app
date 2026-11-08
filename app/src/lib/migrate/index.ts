export { adapterCoverage, parseWorkbook, proposedUnitConversion, type WorkbookCsv } from "./adapters";
export { buildEvidenceMaps, type EvidenceBuild } from "./evidence";
export {
  syntheticMappings,
  syntheticWorkbook,
  preexistingRecords,
  pinlessPeopleCsv,
  SYNTHETIC_CHECKLIST_KEYS,
} from "./fixtures";
export { applyMappings, emptyMappings, fingerprintPayload, mapLegacyRole } from "./mappings";
export { reconcileWorkbook } from "./reconcile";
export { NOT_A_LIVE_MIGRATION, rehearseImport, resolveMode, rollbackLastApply } from "./rehearse";
export { MigrateStore } from "./store";
export { LEGACY_HEADERS, LEGACY_TABS, isLegacyTab, type LegacyTab } from "./tabs";
export type {
  Finding,
  MappingTables,
  MigrateMode,
  ReconciliationReport,
  RehearsalStats,
} from "./types";
