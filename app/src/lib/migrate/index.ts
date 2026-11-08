export { adapterCoverage, parseWorkbook, proposedUnitConversion, type WorkbookCsv } from "./adapters";
export { buildEvidenceMaps, type EvidenceBuild } from "./evidence";
export {
  interpretLegacyStep,
  listClearEquivalences,
  listHistoryOnlyCatalog,
  type StepInterpretation,
} from "./stepEquivalence";
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
export {
  PREVIEW_LIMITATION,
  buildTransferPreview,
  type CurrentSnapshot,
  type ComparisonEvidence,
  type PreviewAction,
  type PreviewDecision,
  type TransferPreview,
} from "./transferPreview";
export {
  createLocalSnapshotState,
  applyAddCandidates,
  idempotentReplay,
  undoLastBatch,
  injectConflict,
  countByCollection,
  preexistingFingerprints,
} from "./localSnapshot";
export {
  SQL_LOCAL_LIMITATION,
  classifySqlReadiness,
  summarizeSqlReadiness,
  skuInsertPlan,
  sanitizeCurrentForSeed,
  modelCodeForSiteName,
  type SqlReadiness,
  type SqlDependencyReport,
  type ResolvedIdentityMaps,
} from "./sqlLocalApply";
export type {
  Finding,
  MappingTables,
  MigrateMode,
  ReconciliationReport,
  RehearsalStats,
} from "./types";
