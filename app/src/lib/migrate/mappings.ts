import type { Finding, MappingTables, ParsedRow } from "./types";
import type { LegacyTab } from "./tabs";
import { interpretLegacyStep } from "./stepEquivalence";

function finding(
  tab: LegacyTab,
  legacyId: string,
  code: Finding["code"],
  detail: string,
): Finding {
  return { tab, legacyId, code, detail, ready: false };
}

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emptyMappings(): MappingTables {
  return {
    peopleByName: {},
    sitesByLegacyId: {},
    sitesByName: {},
    skusByLegacyId: {},
    itemKeys: {},
  };
}

/** Legacy sheet roles → KioskOps roles. Only clear synonyms. */
export function mapLegacyRole(roleRaw: string): { role: string } | { unresolved: string } {
  const role = roleRaw.trim().toLowerCase();
  if (role === "manager" || role === "admin") return { role: "admin" };
  if (role === "technician" || role === "tech") return { role: "tech" };
  if (role === "trainee" || role === "visitor") return { role };
  return { unresolved: roleRaw };
}

function completionLegacyKey(item: object): string {
  const rec = item as { key?: string; itemKey?: string; itemId?: string };
  return String(rec.key ?? rec.itemKey ?? rec.itemId ?? "").trim();
}

/** Resolve person/site/sku/item refs. Unmapped/ambiguous stay explicit — never invented. */
export function applyMappings(
  rows: ParsedRow[],
  maps: MappingTables,
): { rows: ParsedRow[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const out = rows.map((row) => {
    const nextFindings = [...row.findings];
    const fields = { ...row.fields };

    const nameFields = [
      "byName",
      "technicianName",
      "personName",
      "requestedBy",
      "claimedBy",
      "originalAssignee",
      "resolvedBy",
    ] as const;
    for (const field of nameFields) {
      const raw = fields[field]?.trim() ?? "";
      if (!raw) continue;
      const id = maps.peopleByName[normName(raw)];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_person", `Name "${raw}" has no person mapping.`),
        );
        fields[`${field}__personId`] = "";
      } else {
        fields[`${field}__personId`] = id;
      }
    }

    if (row.tab === "People") {
      const raw = fields.name?.trim() ?? "";
      const id = maps.peopleByName[normName(raw)];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_person", `Person "${raw}" is not in the explicit name map.`),
        );
      } else {
        fields.personId = id;
      }
      const mapped = mapLegacyRole(fields.role ?? "");
      if ("unresolved" in mapped) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unresolved", `Role "${mapped.unresolved}" is not mapped.`),
        );
      } else {
        fields.mappedRole = mapped.role;
      }
    }

    const hasLocationIdField = Object.prototype.hasOwnProperty.call(fields, "locationId");
    if (hasLocationIdField) {
      const legacy = fields.locationId?.trim() ?? "";
      if (!legacy) {
        // Present column but blank — source gap, not a missing target map.
        if (row.tab === "Transactions" || row.tab === "KioskFlags" || row.tab === "LocationSKUs") {
          nextFindings.push(
            finding(
              row.tab,
              row.legacyId,
              "missing_source_ref",
              "locationId is blank in the source export. Not invented.",
            ),
          );
        }
      } else {
        const id = maps.sitesByLegacyId[legacy];
        if (!id) {
          nextFindings.push(
            finding(row.tab, row.legacyId, "unmapped_site", `locationId "${legacy}" has no site mapping.`),
          );
        } else fields.siteId = id;
      }
    }

    if (fields.kioskId?.trim()) {
      const legacy = fields.kioskId.trim();
      const byCode = maps.sitesByLegacyId[legacy];
      const locationName = fields.locationName?.trim() ?? "";
      const byName = locationName ? maps.sitesByName[normName(locationName)] : undefined;
      if (byName && byCode && byName !== byCode) {
        nextFindings.push(
          finding(
            row.tab,
            row.legacyId,
            "ambiguous_match",
            `kioskId "${legacy}" maps to ${byCode} but locationName "${locationName}" maps to ${byName}. Left unresolved.`,
          ),
        );
      } else if (byName) {
        fields.siteId = byName;
      } else if (byCode) {
        fields.siteId = byCode;
        if (locationName && !maps.sitesByName[normName(locationName)]) {
          nextFindings.push(
            finding(
              row.tab,
              row.legacyId,
              "ambiguous_match",
              `Used evidenced kioskId "${legacy}" → ${byCode}, but locationName "${locationName}" is not an exact Locations.name.`,
            ),
          );
        }
      } else if (locationName) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_site", `locationName "${locationName}" has no site mapping.`),
        );
      } else {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_site", `kioskId "${legacy}" has no site mapping.`),
        );
      }
    } else if (fields.locationName?.trim() && !fields.siteId) {
      const name = fields.locationName.trim();
      const id = maps.sitesByName[normName(name)];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_site", `locationName "${name}" has no site mapping.`),
        );
      } else fields.siteId = id;
    }

    if (fields.skuId?.trim()) {
      const legacy = fields.skuId.trim();
      const id = maps.skusByLegacyId[legacy];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_sku", `skuId "${legacy}" has no SKU mapping.`),
        );
      } else fields.mappedSkuId = id;
    }

    if (row.tab === "ServiceSessions" && fields.completionsJson?.trim()) {
      try {
        const parsed = JSON.parse(fields.completionsJson) as unknown;
        const items = Array.isArray(parsed) ? parsed : [];
        const historyOnlyKeys: string[] = [];
        const equivalentKeys: string[] = [];
        const mappedItems: Array<Record<string, unknown>> = [];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const key = completionLegacyKey(item);
          if (!key) {
            nextFindings.push(
              finding(
                row.tab,
                row.legacyId,
                "unresolved",
                "Completion item has no key/itemKey/itemId. Kept unresolved.",
              ),
            );
            mappedItems.push({
              ...(item as object),
              interpretation: "history_only",
              current_key: null,
              transfer_ready: false,
              explanation: "Missing legacy step id.",
              mapped: false,
            });
            continue;
          }
          const reading = interpretLegacyStep(key);
          // Explicit map may narrow equivalents further; never invent beyond evidence table.
          const mappedCurrent =
            reading.kind === "equivalent"
              ? maps.itemKeys[key] ?? reading.currentKey
              : maps.itemKeys[key] ?? null;
          const isEquivalent = reading.kind === "equivalent" && mappedCurrent === reading.currentKey;
          if (isEquivalent) equivalentKeys.push(key);
          else historyOnlyKeys.push(key);
          mappedItems.push({
            ...(item as object),
            legacy_item_key: key,
            interpretation: isEquivalent ? "equivalent" : "history_only",
            current_key: isEquivalent ? mappedCurrent : null,
            transfer_ready: false,
            explanation: isEquivalent
              ? reading.explanation
              : reading.kind === "equivalent" && mappedCurrent == null
                ? `${reading.explanation} (current key not in active evidence map for this run.)`
                : reading.explanation,
            evidence: reading.evidence,
            // Preserve original completed/flagged/label/notes/timestamps on the spread object.
            mapped: isEquivalent,
          });
        }
        fields.completionsMappedJson = JSON.stringify(mappedItems);
        fields.legacyCompletionsJson = JSON.stringify(
          mappedItems.filter((entry) => entry.interpretation === "history_only"),
        );
        fields.equivalentCompletionsJson = JSON.stringify(
          mappedItems.filter((entry) => entry.interpretation === "equivalent"),
        );
        if (historyOnlyKeys.length) {
          nextFindings.push(
            finding(
              row.tab,
              row.legacyId,
              "unmapped_item_key",
              `History-only legacy steps (not transfer-ready): ${[...new Set(historyOnlyKeys)].join(", ")}`,
            ),
          );
        }
        if (equivalentKeys.length) {
          // Informational — still not transfer-ready without hosted comparison.
          fields.equivalentStepCount = String(new Set(equivalentKeys).size);
        }
      } catch {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unresolved", "completionsJson is not valid JSON. Held unresolved."),
        );
      }
    }

    findings.push(...nextFindings.filter((f) => !row.findings.includes(f)));
    return { ...row, fields, findings: nextFindings };
  });
  return { rows: out, findings };
}

export function fingerprintPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}
