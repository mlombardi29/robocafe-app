/**
 * Exact transfer-preview classification against a local current snapshot copy.
 * Abstract JSON simulation only — not hosted schema/transaction verification.
 */

import type { LegacyTab } from "./tabs";
import type { Finding, TabParseResult } from "./types";
import { interpretLegacyStep } from "./stepEquivalence";

export const PREVIEW_LIMITATION =
  "This preview mutates only an in-memory JSON copy of the approved current snapshot. It does not open hosted Supabase, verify SQL transactions/RLS, or prove restore from backups.";

export type PreviewAction = "KEEP" | "ADD" | "REVIEW" | "EXCLUDED";

export type PreviewDecision = {
  tab: LegacyTab | "(current)";
  action: PreviewAction;
  legacyId: string;
  currentId?: string | null;
  reason: string;
  provenance: string;
  payload?: Record<string, unknown>;
};

export type CurrentSnapshot = {
  observed_at?: string;
  project_ref?: string;
  counts?: Record<string, number>;
  people: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
  visits: Array<Record<string, unknown>>;
  skus: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  charges: Array<Record<string, unknown>>;
  inventory_tx?: Array<Record<string, unknown>>;
  stock_flags?: Array<Record<string, unknown>>;
  site_skus?: Array<Record<string, unknown>>;
  sku_packs?: Array<Record<string, unknown>>;
  payment_lines?: Array<Record<string, unknown>>;
  pay_rates?: Array<Record<string, unknown>>;
};

export type ComparisonEvidence = {
  entity_candidates?: {
    people?: Array<{
      legacy_name: string;
      current_candidates: Array<{ id: string; name: string }>;
      confidence: string;
    }>;
  };
  site_alias_candidates?: Array<{
    legacy_id: string;
    legacy_name: string;
    current_id: string;
    current_name: string;
    evidence: string;
    status: string;
  }>;
  legacy_duplicate_candidate_detail?: Array<{
    legacy_ids: string[];
    source_rows?: number[];
    all_other_source_fields_identical?: boolean;
    note?: string;
  }>;
  legacy_person_unmatched_visits?: Array<{ name: string; visits: number }>;
  unmatched_person_access_status?: {
    conclusion?: string;
  };
  duplicate_summary?: Record<string, unknown>;
};

export type TransferPreview = {
  limitation: string;
  decisions: PreviewDecision[];
  tabSummary: Record<
    string,
    { keep: number; add: number; review: number; excluded: number; legacySource: number; currentRows: number }
  >;
  reviewQueue: PreviewDecision[];
  addCandidates: PreviewDecision[];
  keepCurrent: PreviewDecision[];
  excluded: PreviewDecision[];
  reconciliation: Array<{ tab: string; legacy: number; keep: number; add: number; review: number; excluded: number; accounted: number; ok: boolean }>;
  findings: Finding[];
};

function decision(
  partial: Omit<PreviewDecision, "action"> & { action: PreviewAction },
): PreviewDecision {
  return partial;
}

export function buildTransferPreview(input: {
  tabs: Record<LegacyTab, TabParseResult>;
  current: CurrentSnapshot;
  comparison: ComparisonEvidence;
}): TransferPreview {
  const decisions: PreviewDecision[] = [];
  const findings: Finding[] = [];

  // KEEP all current visits/people/sites/payments/charges as preexisting.
  for (const visit of input.current.visits) {
    decisions.push(
      decision({
        tab: "(current)",
        action: "KEEP",
        legacyId: String(visit.legacy_id ?? ""),
        currentId: String(visit.id),
        reason: "Existing KioskOps visit preserved (including practice and non-practice).",
        provenance: `current.visits.id=${visit.id}; is_sandbox=${visit.is_sandbox}; status=${visit.status}`,
        payload: { kind: "visit", ...visit },
      }),
    );
  }
  for (const person of input.current.people) {
    decisions.push(
      decision({
        tab: "(current)",
        action: "KEEP",
        legacyId: String(person.legacy_id ?? ""),
        currentId: String(person.id),
        reason: "Existing KioskOps person preserved; no access change from preview.",
        provenance: `current.people.id=${person.id}; goes_by=${person.goes_by}`,
        payload: { kind: "person", id: person.id, goes_by: person.goes_by, role: person.role, active: person.active },
      }),
    );
  }
  for (const site of input.current.sites) {
    decisions.push(
      decision({
        tab: "(current)",
        action: "KEEP",
        legacyId: String(site.legacy_id ?? ""),
        currentId: String(site.id),
        reason: "Existing KioskOps site preserved (practice and live).",
        provenance: `current.sites.id=${site.id}; name=${site.name}; is_sandbox=${site.is_sandbox}`,
        payload: { kind: "site", id: site.id, name: site.name, is_sandbox: site.is_sandbox },
      }),
    );
  }
  for (const pay of input.current.payments) {
    decisions.push(
      decision({
        tab: "(current)",
        action: "KEEP",
        legacyId: String(pay.legacy_id ?? ""),
        currentId: String(pay.id),
        reason: "Existing payment preserved.",
        provenance: `current.payments.id=${pay.id}`,
        payload: { kind: "payment", ...pay },
      }),
    );
  }
  for (const charge of input.current.charges) {
    decisions.push(
      decision({
        tab: "(current)",
        action: "KEEP",
        legacyId: String(charge.legacy_id ?? ""),
        currentId: String(charge.id),
        reason: "Existing charge preserved.",
        provenance: `current.charges.id=${charge.id}`,
        payload: { kind: "charge", ...charge },
      }),
    );
  }

  const personCandidates = new Map(
    (input.comparison.entity_candidates?.people ?? []).map((row) => [row.legacy_name.trim().toLowerCase(), row]),
  );
  const siteAliases = new Map(
    (input.comparison.site_alias_candidates ?? []).map((row) => [row.legacy_id, row]),
  );
  const repeatIds = new Set<string>();
  for (const group of input.comparison.legacy_duplicate_candidate_detail ?? []) {
    for (const id of group.legacy_ids) repeatIds.add(id);
  }
  const unmatchedNames = new Set(
    (input.comparison.legacy_person_unmatched_visits ?? []).map((row) => row.name.trim().toLowerCase()),
  );

  // People tab
  for (const row of input.tabs.People.rows) {
    const name = row.fields.name?.trim() ?? "";
    const key = name.toLowerCase();
    const candidate = personCandidates.get(key);
    if (unmatchedNames.has(key) || (candidate && candidate.current_candidates.length === 0)) {
      decisions.push(
        decision({
          tab: "People",
          action: "REVIEW",
          legacyId: row.legacyId,
          reason:
            "Historical identity proposal only — no current name match. Do not grant login/access; do not infer offboarding.",
          provenance: `People row name=${name}; ${input.comparison.unmatched_person_access_status?.conclusion ?? ""}`,
          payload: {
            kind: "historical_person_proposal",
            legacy_name: name,
            role: row.fields.role,
            active_in_legacy: row.fields.active,
            grant_login: false,
            original: row.fields,
          },
        }),
      );
      continue;
    }
    if (candidate && candidate.current_candidates.length === 1) {
      decisions.push(
        decision({
          tab: "People",
          action: "REVIEW",
          legacyId: row.legacyId,
          currentId: candidate.current_candidates[0]?.id,
          reason: "Unique goes_by/name candidate exists; identity not proven. Keep current person; do not ADD a duplicate.",
          provenance: candidate.confidence,
          payload: {
            kind: "person_link_candidate",
            legacy_name: name,
            current_id: candidate.current_candidates[0]?.id,
            stamp_legacy_id_proposed: false,
          },
        }),
      );
      continue;
    }
    decisions.push(
      decision({
        tab: "People",
        action: "REVIEW",
        legacyId: row.legacyId,
        reason: "Person row needs review (no unique clear candidate rule matched).",
        provenance: `People name=${name}`,
        payload: { original: row.fields },
      }),
    );
  }

  // Locations
  for (const row of input.tabs.Locations.rows) {
    const alias = siteAliases.get(row.legacyId);
    if (alias) {
      decisions.push(
        decision({
          tab: "Locations",
          action: "REVIEW",
          legacyId: row.legacyId,
          currentId: alias.current_id,
          reason: "Site alias candidate only — not independently confirmed. Do not ADD a duplicate live site; never map history onto practice sites.",
          provenance: `${alias.evidence}; status=${alias.status}`,
          payload: {
            kind: "site_link_candidate",
            legacy_name: row.fields.name,
            current_id: alias.current_id,
            current_name: alias.current_name,
          },
        }),
      );
    } else {
      decisions.push(
        decision({
          tab: "Locations",
          action: "REVIEW",
          legacyId: row.legacyId,
          reason: "No confirmed current site link. Withheld from ADD.",
          provenance: `Locations.id=${row.legacyId}; name=${row.fields.name}`,
          payload: { original: row.fields },
        }),
      );
    }
  }

  // ServiceSessions
  for (const row of input.tabs.ServiceSessions.rows) {
    const tech = row.fields.technicianName?.trim() ?? "";
    const inRepeat = repeatIds.has(row.legacyId);
    const completions = (() => {
      try {
        return JSON.parse(row.fields.completionsJson || "[]");
      } catch {
        return [];
      }
    })();
    const interpreted = Array.isArray(completions)
      ? completions.map((item: Record<string, unknown>) => {
          const key = String(item.itemId ?? item.key ?? item.itemKey ?? "");
          const reading = interpretLegacyStep(key);
          return {
            ...item,
            legacy_item_key: key,
            interpretation: reading.kind,
            current_key: reading.kind === "equivalent" ? reading.currentKey : null,
            transfer_ready: false,
            explanation: reading.explanation,
          };
        })
      : [];
    if (inRepeat) {
      decisions.push(
        decision({
          tab: "ServiceSessions",
          action: "REVIEW",
          legacyId: row.legacyId,
          reason: "Possible repeated-visit group (same tech/site/date/start). Review — not deletion evidence.",
          provenance: `ServiceSessions.id=${row.legacyId}; technician=${tech}; serviceDate=${row.fields.serviceDate}`,
          payload: { kind: "visit_repeat_candidate", original: row.fields, completions: interpreted },
        }),
      );
      continue;
    }
    decisions.push(
      decision({
        tab: "ServiceSessions",
        action: "ADD",
        legacyId: row.legacyId,
        reason: unmatchedNames.has(tech.toLowerCase())
          ? "ADD candidate historical visit for unmatched worker identity (no login). No cross-source duplicate confirmed."
          : "ADD candidate historical visit; no current legacy_id match and no confirmed cross-source duplicate.",
        provenance: `ServiceSessions.id=${row.legacyId}; kioskId=${row.fields.kioskId}; serviceDate=${row.fields.serviceDate}`,
        payload: {
          kind: "visit_add_candidate",
          legacy_id: row.legacyId,
          technicianName: tech,
          historical_person_only: unmatchedNames.has(tech.toLowerCase()),
          grant_login: false,
          original: row.fields,
          completions: interpreted,
        },
      }),
    );
  }

  // SKUs — current empty → ADD candidates (catalogue), unresolved unit issues stay REVIEW flags on anomalies via findings already
  for (const row of input.tabs.SKUs.rows) {
    const anomaly = row.findings.some((f) =>
      ["unit_conversion_proposed", "fractional_stock_delta", "negative_stock_delta"].includes(f.code),
    );
    decisions.push(
      decision({
        tab: "SKUs",
        action: anomaly ? "REVIEW" : "ADD",
        legacyId: row.legacyId,
        reason: anomaly
          ? "SKU has unit/stock anomaly flags; hold for review before treating as ready catalogue ADD."
          : "No current SKUs; ADD candidate catalogue row by legacy id.",
        provenance: `SKUs.id=${row.legacyId}; name=${row.fields.name}`,
        payload: { kind: "sku_add_candidate", original: row.fields, findings: row.findings },
      }),
    );
  }

  for (const row of input.tabs.Transactions.rows) {
    decisions.push(
      decision({
        tab: "Transactions",
        action: "REVIEW",
        legacyId: row.legacyId,
        reason: "Stock movement unresolved (blank location and/or quantity anomalies). Not silently applied.",
        provenance: `Transactions.id=${row.legacyId}; skuId=${row.fields.skuId}; locationId=${row.fields.locationId || "(blank)"}`,
        payload: { kind: "inventory_tx_review", original: row.fields, findings: row.findings },
      }),
    );
  }

  for (const row of input.tabs.LocationSKUs.rows) {
    decisions.push(
      decision({
        tab: "LocationSKUs",
        action: "ADD",
        legacyId: row.legacyId,
        reason: "No current site_skus rows; ADD candidate link by legacy location/sku ids (site identity still REVIEW separately).",
        provenance: `LocationSKUs ${row.legacyId}`,
        payload: { kind: "site_sku_add_candidate", original: row.fields },
      }),
    );
  }

  for (const row of input.tabs.KioskFlags.rows) {
    decisions.push(
      decision({
        tab: "KioskFlags",
        action: "ADD",
        legacyId: row.legacyId,
        reason: "No current stock_flags; ADD candidate historical flag row.",
        provenance: `KioskFlags.id=${row.legacyId}`,
        payload: { kind: "stock_flag_add_candidate", original: row.fields },
      }),
    );
  }

  for (const row of input.tabs.Payments.rows) {
    decisions.push(
      decision({
        tab: "Payments",
        action: "REVIEW",
        legacyId: row.legacyId,
        reason: "Payment/financial history unresolved while current payments are empty — review before ADD.",
        provenance: `Payments.id=${row.legacyId}; personName=${row.fields.personName}`,
        payload: { kind: "payment_review", original: row.fields },
      }),
    );
  }

  for (const row of input.tabs.Charges.rows) {
    decisions.push(
      decision({
        tab: "Charges",
        action: "REVIEW",
        legacyId: row.legacyId,
        reason: "Charge/financial history unresolved while current charges are empty — review before ADD.",
        provenance: `Charges.id=${row.legacyId}; personName=${row.fields.personName}; amount=${row.fields.amount}`,
        payload: { kind: "charge_review", original: row.fields },
      }),
    );
  }

  for (const row of input.tabs.ScheduleOverrides.rows) {
    decisions.push(
      decision({
        tab: "ScheduleOverrides",
        action: "ADD",
        legacyId: row.legacyId,
        reason: "Historical schedule override ADD candidate (coverage history).",
        provenance: `ScheduleOverrides ${row.legacyId}`,
        payload: { kind: "schedule_add_candidate", original: row.fields },
      }),
    );
  }

  for (const row of input.tabs.Config.rows) {
    const secret = row.findings.some((f) => f.code === "secret_config_held");
    decisions.push(
      decision({
        tab: "Config",
        action: secret ? "EXCLUDED" : "REVIEW",
        legacyId: row.legacyId,
        reason: secret
          ? "Sensitive/oversized config excluded from transfer preview."
          : "Config keys need explicit owner review before any apply.",
        provenance: `Config.key=${row.fields.key}`,
        payload: { kind: "config", key: row.fields.key, value_omitted: true },
      }),
    );
  }

  // Always exclude PIN material if somehow present
  for (const row of input.tabs.People.rows) {
    if ((row.fields.pin ?? "") !== "") {
      decisions.push(
        decision({
          tab: "People",
          action: "EXCLUDED",
          legacyId: `${row.legacyId}:pin`,
          reason: "PIN values are never transferred.",
          provenance: "People.pin excluded",
        }),
      );
      findings.push({
        tab: "People",
        legacyId: row.legacyId,
        code: "pin_not_migrated",
        detail: "PIN excluded from preview manifest.",
        ready: false,
      });
    }
  }

  const tabSummary: TransferPreview["tabSummary"] = {};
  const tabs: Array<LegacyTab | "(current)"> = [
    "(current)",
    "SKUs",
    "Transactions",
    "Locations",
    "LocationSKUs",
    "KioskFlags",
    "People",
    "Config",
    "ServiceSessions",
    "ScheduleOverrides",
    "Payments",
    "Charges",
  ];
  for (const tab of tabs) {
    const rows = decisions.filter((d) => d.tab === tab);
    tabSummary[tab] = {
      keep: rows.filter((d) => d.action === "KEEP").length,
      add: rows.filter((d) => d.action === "ADD").length,
      review: rows.filter((d) => d.action === "REVIEW").length,
      excluded: rows.filter((d) => d.action === "EXCLUDED").length,
      legacySource: tab === "(current)" ? 0 : input.tabs[tab as LegacyTab]?.rows.length ?? 0,
      currentRows:
        tab === "(current)"
          ? input.current.visits.length +
            input.current.people.length +
            input.current.sites.length +
            input.current.payments.length +
            input.current.charges.length
          : 0,
    };
  }

  const reconciliation = (Object.keys(tabSummary) as string[])
    .filter((tab) => tab !== "(current)")
    .map((tab) => {
      const s = tabSummary[tab]!;
      const accounted = s.add + s.review + s.excluded;
      // People may have extra EXCLUDED pin rows; allow accounted >= legacySource
      const ok = accounted >= s.legacySource;
      return {
        tab,
        legacy: s.legacySource,
        keep: s.keep,
        add: s.add,
        review: s.review,
        excluded: s.excluded,
        accounted,
        ok,
      };
    });

  return {
    limitation: PREVIEW_LIMITATION,
    decisions,
    tabSummary,
    reviewQueue: decisions.filter((d) => d.action === "REVIEW"),
    addCandidates: decisions.filter((d) => d.action === "ADD"),
    keepCurrent: decisions.filter((d) => d.action === "KEEP"),
    excluded: decisions.filter((d) => d.action === "EXCLUDED"),
    reconciliation,
    findings,
  };
}
