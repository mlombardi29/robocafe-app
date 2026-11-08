/**
 * Local PostgreSQL transfer-preview apply helpers.
 * Schema/FK readiness + idempotent ADD for rows that need no fabricated identity maps.
 * Not live import machinery. Not hosted Supabase.
 */

import type { PreviewDecision } from "./transferPreview";
import type { CurrentSnapshot } from "./transferPreview";

export const SQL_LOCAL_LIMITATION =
  "Local PostgreSQL proof only. Applies schema-ready ADD rows without inventing person/site identity maps. Hosted project untouched. Does not activate live import.";

export type SqlReadiness =
  | "ready"
  | "blocked_pending_decision"
  | "withheld_review"
  | "excluded";

export type SqlDependencyReport = {
  tab: string;
  legacyId: string;
  readiness: SqlReadiness;
  targetTable: string | null;
  requiredFks: string[];
  missing: string[];
  smallestDecision: string | null;
};

export type ResolvedIdentityMaps = {
  /** Explicit owner-approved only. Empty by default — never inferred. */
  personByLegacyName?: Record<string, string>;
  siteByLegacyKioskId?: Record<string, string>;
  siteByLegacyLocationId?: Record<string, string>;
  skuByLegacyId?: Record<string, string>;
};

export function classifySqlReadiness(
  decision: PreviewDecision,
  maps: ResolvedIdentityMaps = {},
): SqlDependencyReport {
  if (decision.action === "EXCLUDED") {
    return {
      tab: decision.tab,
      legacyId: decision.legacyId,
      readiness: "excluded",
      targetTable: null,
      requiredFks: [],
      missing: [],
      smallestDecision: null,
    };
  }
  if (decision.action === "KEEP") {
    return {
      tab: decision.tab,
      legacyId: decision.legacyId,
      readiness: "withheld_review",
      targetTable: null,
      requiredFks: [],
      missing: [],
      smallestDecision: null,
    };
  }
  if (decision.action === "REVIEW") {
    return {
      tab: decision.tab,
      legacyId: decision.legacyId,
      readiness: "withheld_review",
      targetTable: null,
      requiredFks: [],
      missing: [],
      smallestDecision: null,
    };
  }

  switch (decision.tab) {
    case "SKUs": {
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: "ready",
        targetTable: "public.skus",
        requiredFks: [],
        missing: [],
        smallestDecision: null,
      };
    }
    case "ServiceSessions": {
      const original = (decision.payload?.original ?? {}) as Record<string, unknown>;
      const tech = String(decision.payload?.technicianName ?? original.technicianName ?? "").trim();
      const kioskId = String(original.kioskId ?? "").trim();
      const requiredFks = ["people.id (person_id)", "sites.id (site_id)"];
      const missing: string[] = [];
      if (!tech || !maps.personByLegacyName?.[tech.toLowerCase()]) missing.push("person_id");
      if (!kioskId || !maps.siteByLegacyKioskId?.[kioskId]) missing.push("site_id");
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: missing.length ? "blocked_pending_decision" : "ready",
        targetTable: "public.service_sessions",
        requiredFks,
        missing,
        smallestDecision: missing.length
          ? "Approve explicit person_id + site_id maps for historical visits (no login inference). Unmatched worker history stays separate until decided."
          : null,
      };
    }
    case "LocationSKUs": {
      const original = (decision.payload?.original ?? {}) as Record<string, unknown>;
      const locationId = String(original.locationId ?? "").trim();
      const skuId = String(original.skuId ?? "").trim();
      const missing: string[] = [];
      if (!locationId || !maps.siteByLegacyLocationId?.[locationId]) missing.push("site_id");
      if (!skuId || !maps.skuByLegacyId?.[skuId]) missing.push("sku_id");
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: missing.length ? "blocked_pending_decision" : "ready",
        targetTable: "public.site_skus",
        requiredFks: ["sites.id", "skus.id"],
        missing,
        smallestDecision: missing.length
          ? "Confirm site alias (legacy locationId → current sites.id, never practice) and ensure SKU legacy_id already loaded."
          : null,
      };
    }
    case "KioskFlags": {
      const original = (decision.payload?.original ?? {}) as Record<string, unknown>;
      const locationId = String(original.locationId ?? "").trim();
      const missing: string[] = [];
      if (!locationId || !maps.siteByLegacyLocationId?.[locationId]) missing.push("site_id");
      // sku optional in schema
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: missing.length ? "blocked_pending_decision" : "ready",
        targetTable: "public.stock_flags",
        requiredFks: ["sites.id"],
        missing,
        smallestDecision: missing.length
          ? "Confirm site alias for flag locationId before stock_flags insert."
          : null,
      };
    }
    case "ScheduleOverrides": {
      const original = (decision.payload?.original ?? {}) as Record<string, unknown>;
      const kioskId = String(original.kioskId ?? "").trim();
      const missing: string[] = [];
      if (!kioskId || !maps.siteByLegacyKioskId?.[kioskId]) missing.push("site_id");
      missing.push("show_days.field_map");
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: "blocked_pending_decision",
        targetTable: "public.show_days",
        requiredFks: ["sites.id", "date", "status mapping"],
        missing,
        smallestDecision:
          "Decide ScheduleOverrides → show_days field map (coverageRequested/status) and confirm kioskId → sites.id (never practice).",
      };
    }
    default:
      return {
        tab: decision.tab,
        legacyId: decision.legacyId,
        readiness: "blocked_pending_decision",
        targetTable: null,
        requiredFks: [],
        missing: ["unknown_tab"],
        smallestDecision: `No SQL apply path defined for tab ${decision.tab}.`,
      };
  }
}

export function summarizeSqlReadiness(reports: SqlDependencyReport[]): {
  ready: number;
  blocked_pending_decision: number;
  withheld_review: number;
  excluded: number;
  byTab: Record<string, Record<SqlReadiness, number>>;
  smallestDecisions: string[];
} {
  const byTab: Record<string, Record<SqlReadiness, number>> = {};
  const totals = {
    ready: 0,
    blocked_pending_decision: 0,
    withheld_review: 0,
    excluded: 0,
  };
  const decisions = new Set<string>();
  for (const row of reports) {
    totals[row.readiness] += 1;
    byTab[row.tab] ??= {
      ready: 0,
      blocked_pending_decision: 0,
      withheld_review: 0,
      excluded: 0,
    };
    byTab[row.tab][row.readiness] += 1;
    if (row.smallestDecision) decisions.add(row.smallestDecision);
  }
  return { ...totals, byTab, smallestDecisions: [...decisions] };
}

/** Application-level idempotent SKU insert plan (schema has no unique(legacy_id)). */
export function skuInsertPlan(decision: PreviewDecision): {
  legacyId: string;
  name: string;
  baseUnit: string | null;
  active: boolean;
  reorderThreshold: number | null;
} | null {
  if (decision.tab !== "SKUs" || decision.action !== "ADD") return null;
  const original = (decision.payload?.original ?? {}) as Record<string, unknown>;
  const name = String(original.name ?? "").trim();
  if (!name) return null;
  const reorder = original.reorderThreshold;
  return {
    legacyId: decision.legacyId,
    name,
    baseUnit: original.baseUnit != null && String(original.baseUnit).trim() ? String(original.baseUnit) : null,
    active: String(original.active ?? "true").toLowerCase() !== "false",
    reorderThreshold:
      reorder === "" || reorder == null || Number.isNaN(Number(reorder)) ? null : Number(reorder),
  };
}

export function sanitizeCurrentForSeed(current: CurrentSnapshot): {
  people: Array<{ id: string; goes_by: string; role: string; active: boolean; mode: string; is_sandbox: boolean }>;
  sites: Array<{ id: string; name: string; short_name: string; active: boolean; is_sandbox: boolean }>;
  visits: Array<{
    id: string;
    site_id: string;
    person_id: string;
    status: string;
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    is_sandbox: boolean;
    legacy_id: string | null;
    submitted_at: string | null;
  }>;
} {
  return {
    people: current.people.map((p) => ({
      id: String(p.id),
      goes_by: String(p.goes_by ?? "tech"),
      role: String(p.role ?? "tech"),
      active: Boolean(p.active ?? true),
      mode: String(p.mode ?? "live"),
      is_sandbox: Boolean(p.is_sandbox ?? false),
    })),
    sites: current.sites.map((s) => ({
      id: String(s.id),
      name: String(s.name),
      short_name: String(s.short_name ?? s.name),
      active: Boolean(s.active ?? true),
      is_sandbox: Boolean(s.is_sandbox ?? false),
    })),
    visits: current.visits.map((v) => ({
      id: String(v.id),
      site_id: String(v.site_id),
      person_id: String(v.person_id),
      status: String(v.status ?? "completed"),
      service_date: String(v.service_date),
      start_at: v.start_at != null ? String(v.start_at) : null,
      end_at: v.end_at != null ? String(v.end_at) : null,
      is_sandbox: Boolean(v.is_sandbox ?? false),
      legacy_id: v.legacy_id != null ? String(v.legacy_id) : null,
      submitted_at: v.submitted_at != null ? String(v.submitted_at) : null,
    })),
  };
}

export function modelCodeForSiteName(name: string, shortName: string): "s35" | "s22" | "s5" {
  const hay = `${name} ${shortName}`.toLowerCase();
  if (hay.includes("rbc") || hay.includes("s5") || hay.includes("bud")) return "s5";
  if (hay.includes("uoft") || hay.includes("2.2") || hay.includes("sid")) return "s22";
  return "s35";
}
