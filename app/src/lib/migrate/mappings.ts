import type { Finding, MappingTables, ParsedRow } from "./types";
import type { LegacyTab } from "./tabs";

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

/** Resolve person/site/sku/item refs. Unmapped stay explicit findings — never invented. */
export function applyMappings(
  rows: ParsedRow[],
  maps: MappingTables,
): { rows: ParsedRow[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const out = rows.map((row) => {
    const nextFindings = [...row.findings];
    const fields = { ...row.fields };

    const nameFields: Array<{ field: string; tabNeed: boolean }> = [
      { field: "byName", tabNeed: true },
      { field: "technicianName", tabNeed: true },
      { field: "personName", tabNeed: true },
      { field: "requestedBy", tabNeed: true },
      { field: "claimedBy", tabNeed: true },
      { field: "originalAssignee", tabNeed: true },
      { field: "resolvedBy", tabNeed: true },
    ];
    for (const { field } of nameFields) {
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
      const role = (fields.role ?? "").trim().toLowerCase();
      if (role === "manager") fields.mappedRole = "admin";
      else if (role === "admin" || role === "tech" || role === "trainee" || role === "visitor") fields.mappedRole = role;
      else {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unresolved", `Role "${fields.role}" is not mapped.`),
        );
      }
    }

    if (fields.locationId?.trim()) {
      const legacy = fields.locationId.trim();
      const id = maps.sitesByLegacyId[legacy];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_site", `locationId "${legacy}" has no site mapping.`),
        );
      } else fields.siteId = id;
    }
    if (fields.kioskId?.trim() && !fields.siteId) {
      const legacy = fields.kioskId.trim();
      const id = maps.sitesByLegacyId[legacy] ?? maps.sitesByName[normName(legacy)];
      if (!id) {
        nextFindings.push(
          finding(row.tab, row.legacyId, "unmapped_site", `kioskId "${legacy}" has no site mapping.`),
        );
      } else fields.siteId = id;
    }
    if (fields.locationName?.trim() && !fields.siteId) {
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
        const unmapped: string[] = [];
        const mapped: Array<Record<string, unknown>> = [];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const key = String((item as { key?: string }).key ?? (item as { itemKey?: string }).itemKey ?? "");
          if (!key) continue;
          const target = maps.itemKeys[key];
          if (!target) {
            unmapped.push(key);
            mapped.push({ ...(item as object), legacy_item_key: key, mapped: false });
          } else {
            mapped.push({ ...(item as object), legacy_item_key: key, item_id: target, mapped: true });
          }
        }
        fields.completionsMappedJson = JSON.stringify(mapped);
        if (unmapped.length) {
          fields.legacyCompletionsJson = JSON.stringify(
            mapped.filter((entry) => entry.mapped === false),
          );
          nextFindings.push(
            finding(
              row.tab,
              row.legacyId,
              "unmapped_item_key",
              `Unmapped completion keys kept in legacy_completions: ${unmapped.join(", ")}`,
            ),
          );
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
