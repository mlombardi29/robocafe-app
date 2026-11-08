import type { LegacyTab } from "./tabs";

export type FindingCode =
  | "header_mismatch"
  | "ambiguous_columns"
  | "missing_stable_id"
  | "missing_source_ref"
  | "unmapped_person"
  | "unmapped_site"
  | "unmapped_sku"
  | "unmapped_item_key"
  | "ambiguous_match"
  | "pin_not_migrated"
  | "secret_config_held"
  | "unit_conversion_proposed"
  | "negative_stock_delta"
  | "fractional_stock_delta"
  | "conflict_existing_visit"
  | "conflict_existing_payment"
  | "conflict_payload"
  | "write_blocked"
  | "live_mode_blocked"
  | "unresolved";

export type Finding = {
  tab: LegacyTab | "(workbook)";
  legacyId: string;
  code: FindingCode;
  detail: string;
  ready: false;
};

export type MigrateMode = "dry_run" | "local_apply";

export type MappedRef = {
  legacyKey: string;
  targetId: string | null;
  label: string;
};

export type ParsedRow = {
  tab: LegacyTab;
  legacyId: string;
  fields: Record<string, string>;
  findings: Finding[];
};

export type TabParseResult = {
  tab: LegacyTab;
  rows: ParsedRow[];
  findings: Finding[];
  accepted: number;
  held: number;
};

export type PersonMap = Record<string, string>;
export type SiteMap = Record<string, string>;
export type SkuMap = Record<string, string>;
export type ItemKeyMap = Record<string, string>;

export type MappingTables = {
  peopleByName: PersonMap;
  sitesByLegacyId: SiteMap;
  sitesByName: SiteMap;
  skusByLegacyId: SkuMap;
  itemKeys: ItemKeyMap;
};

export type ExistingRecord = {
  kind: "visit" | "payment" | "charge" | "other";
  legacyId: string;
  fingerprint: string;
  preexisting: boolean;
  payload: Record<string, unknown>;
};

export type StagedRecord = {
  kind: ExistingRecord["kind"];
  legacyId: string;
  fingerprint: string;
  payload: Record<string, unknown>;
  sourceTab: LegacyTab;
};

export type RehearsalStats = {
  mode: MigrateMode;
  tabCounts: Record<LegacyTab, { source: number; staged: number; held: number }>;
  inserted: number;
  unchangedReplay: number;
  conflicts: number;
  findings: Finding[];
  writesAttempted: number;
  writesApplied: number;
  caveat: string;
};

export type ReconciliationReport = {
  rowCounts: Array<{ tab: LegacyTab; source: number; inStore: number; match: boolean }>;
  stockBySku: Array<{
    skuLegacyId: string;
    deltaSum: number | null;
    fractional: boolean;
    negative: boolean;
    note: string;
  }>;
  hoursByPerson: Array<{ person: string; hoursFromCharges: number; sessionsCounted: number }>;
  paymentTotal: number;
  chargeTotal: number;
  mismatches: Finding[];
};
