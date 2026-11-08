import type { TabParseResult } from "./types";
import type { Finding, MappingTables } from "./types";
import type { LegacyTab } from "./tabs";
import { emptyMappings } from "./mappings";

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function finding(
  tab: LegacyTab | "(workbook)",
  legacyId: string,
  code: Finding["code"],
  detail: string,
): Finding {
  return { tab, legacyId, code, detail, ready: false };
}

export type EvidenceBuild = {
  maps: MappingTables;
  findings: Finding[];
  provenance: {
    people: Array<{ name: string; personId: string; evidence: string }>;
    sites: Array<{ alias: string; siteId: string; evidence: string }>;
    skus: Array<{ skuId: string; evidence: string }>;
    itemKeys: Array<{ legacyKey: string; targetKey: string; evidence: string }>;
    ambiguous: Finding[];
  };
};

/**
 * Build maps only from clear in-workbook evidence.
 * Does not invent KioskOps UUIDs or ambiguous aliases.
 */
export function buildEvidenceMaps(
  tabs: Record<LegacyTab, TabParseResult>,
  knownChecklistKeys: Iterable<string> = [],
): EvidenceBuild {
  const maps = emptyMappings();
  const findings: Finding[] = [];
  const provenance: EvidenceBuild["provenance"] = {
    people: [],
    sites: [],
    skus: [],
    itemKeys: [],
    ambiguous: [],
  };

  const known = new Set([...knownChecklistKeys].map((key) => key.trim()).filter(Boolean));

  for (const row of tabs.People.rows) {
    const name = row.fields.name?.trim() ?? "";
    if (!name) continue;
    const personId = `person:${normName(name)}`;
    maps.peopleByName[normName(name)] = personId;
    provenance.people.push({
      name,
      personId,
      evidence: "People tab exact name → stable legacy person id (no PIN, no invented hosted id)",
    });
  }

  const locationsByName = new Map<string, { id: string; name: string }>();
  for (const row of tabs.Locations.rows) {
    const id = row.fields.id?.trim() ?? "";
    const name = row.fields.name?.trim() ?? "";
    if (!id || !name) continue;
    maps.sitesByLegacyId[id] = id;
    maps.sitesByName[normName(name)] = id;
    locationsByName.set(normName(name), { id, name });
    provenance.sites.push({
      alias: id,
      siteId: id,
      evidence: `Locations.id exact value "${id}" (${name})`,
    });
  }

  // Short kiosk codes (sinai/bud/uoft) only when every evidenced pair agrees.
  const aliasVotes = new Map<string, Map<string, number>>();
  const ambiguousAliases = new Set<string>();
  for (const row of tabs.ServiceSessions.rows) {
    const code = row.fields.kioskId?.trim() ?? "";
    const locationName = row.fields.locationName?.trim() ?? "";
    if (!code || !locationName) continue;
    const match = locationsByName.get(normName(locationName));
    if (!match) {
      const f = finding(
        "ServiceSessions",
        row.legacyId,
        "ambiguous_match",
        `locationName "${locationName}" does not exactly match a Locations.name; kioskId "${code}" not used as evidence from this row.`,
      );
      findings.push(f);
      provenance.ambiguous.push(f);
      continue;
    }
    if (maps.sitesByLegacyId[code] && maps.sitesByLegacyId[code] !== match.id) {
      ambiguousAliases.add(code);
    }
    const votes = aliasVotes.get(code) ?? new Map<string, number>();
    votes.set(match.id, (votes.get(match.id) ?? 0) + 1);
    aliasVotes.set(code, votes);
  }
  for (const [code, votes] of aliasVotes) {
    if (ambiguousAliases.has(code)) {
      const f = finding(
        "(workbook)",
        code,
        "ambiguous_match",
        `kioskId "${code}" pointed at more than one Locations.id across sessions. Left unmapped.`,
      );
      findings.push(f);
      provenance.ambiguous.push(f);
      continue;
    }
    if (votes.size !== 1) {
      const f = finding(
        "(workbook)",
        code,
        "ambiguous_match",
        `kioskId "${code}" has conflicting Location name evidence. Left unmapped.`,
      );
      findings.push(f);
      provenance.ambiguous.push(f);
      continue;
    }
    const siteId = [...votes.keys()][0]!;
    maps.sitesByLegacyId[code] = siteId;
    provenance.sites.push({
      alias: code,
      siteId,
      evidence: `ServiceSessions.kioskId "${code}" consistently paired with Locations.name that resolves to ${siteId}`,
    });
  }

  for (const row of tabs.SKUs.rows) {
    const id = row.fields.id?.trim() ?? "";
    if (!id) continue;
    maps.skusByLegacyId[id] = id;
    provenance.skus.push({
      skuId: id,
      evidence: "SKUs.id exact value present in catalogue tab",
    });
  }

  // Exact checklist key overlap only — never synonym invention.
  const seenItemIds = new Set<string>();
  for (const row of tabs.ServiceSessions.rows) {
    const raw = row.fields.completionsJson?.trim() ?? "";
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const rec = item as { key?: string; itemKey?: string; itemId?: string };
        const legacyKey = String(rec.key ?? rec.itemKey ?? rec.itemId ?? "").trim();
        if (!legacyKey || seenItemIds.has(legacyKey)) continue;
        seenItemIds.add(legacyKey);
        if (known.has(legacyKey)) {
          maps.itemKeys[legacyKey] = legacyKey;
          provenance.itemKeys.push({
            legacyKey,
            targetKey: legacyKey,
            evidence: "Exact match between legacy completion itemId/key and current checklist key",
          });
        }
      }
    } catch {
      // parse errors handled later in applyMappings
    }
  }

  return { maps, findings, provenance };
}
