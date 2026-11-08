/** Read-only catalogue preview. It never writes stock or invents a KC max. */

export type CatalogueIssue = {
  legacyId: string;
  name: string;
  code: string;
  detail: string;
};

export type ProposedPack = { name: string; perBase: number };

export type ProposedSku = {
  legacyId: string;
  name: string;
  rawBaseUnit: string;
  proposedBaseUnit: string;
  conversionFactor: number | null;
  packs: ProposedPack[];
  supplier: string | null;
  reorderRaw: number | null;
  derivedRaw: number | null;
  derivedProposed: number | null;
  kcMax: null;
  siteLinksProposed: [];
  checklistLinkProposed: null;
  issues: CatalogueIssue[];
};

export type CataloguePreview = {
  activeCount: number;
  skippedInactive: number;
  proposals: ProposedSku[];
  issues: CatalogueIssue[];
  writes: 0;
};

const EXPECTED_COLUMNS = 15;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === "\"" && source[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") quoted = false;
      else cell += char;
      continue;
    }
    if (char === "\"") {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((part) => part.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((part) => part.trim() !== "")) rows.push(row);
  }
  return rows;
}

function numberOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function conversionFor(baseUnit: string, note: string): { unit: string; factor: number; detail: string } | null {
  const unit = baseUnit.trim().toLowerCase();
  const text = note.toLowerCase();
  if (unit === "sleeve" && /50\s*cups/.test(text)) {
    return { unit: "cup", factor: 50, detail: "Historical sleeve counts would convert to cups at 50 per sleeve. Not applied." };
  }
  if (unit === "sleeve" && /100\s*lids/.test(text)) {
    return { unit: "lid", factor: 100, detail: "Historical sleeve counts would convert to lids at 100 per sleeve. Not applied." };
  }
  return null;
}

function packsFrom(cells: string[]): ProposedPack[] {
  const packs: ProposedPack[] = [];
  const first = numberOrNull(cells[6]);
  if (cells[5]?.trim() && first != null && first > 0) packs.push({ name: cells[5].trim(), perBase: first });
  const second = numberOrNull(cells[10]);
  if (cells[9]?.trim() && second != null && second > 0) packs.push({ name: cells[9].trim(), perBase: second });
  return packs;
}

export function previewCatalogue(csv: string): CataloguePreview {
  const table = parseCsv(csv.trim());
  const body = table.slice(1);
  const issues: CatalogueIssue[] = [];
  const proposals: ProposedSku[] = [];
  let skippedInactive = 0;
  let activeCount = 0;
  for (const cells of body) {
    const legacyId = cells[0]?.trim() ?? "";
    const name = cells[1]?.trim() || "(unnamed)";
    if (cells.length !== EXPECTED_COLUMNS) {
      if (cells[2]?.trim().toUpperCase() === "TRUE") activeCount += 1;
      else if (cells[2]?.trim().toUpperCase() === "FALSE") skippedInactive += 1;
      issues.push({
        legacyId,
        name,
        code: "ambiguous_columns",
        detail: `This row has ${cells.length} fields and the header has ${EXPECTED_COLUMNS}. Reorder and derived stock were not taken from it.`,
      });
      continue;
    }
    if (cells[2]?.trim().toUpperCase() !== "TRUE") {
      skippedInactive += 1;
      continue;
    }
    activeCount += 1;
    const rawBaseUnit = cells[3]?.trim() ?? "";
    const note = cells[4]?.trim() ?? "";
    const conversion = conversionFor(rawBaseUnit, note);
    const derivedRaw = numberOrNull(cells[14]);
    const reorderRaw = numberOrNull(cells[13]);
    const supplier = cells[7]?.trim() || cells[11]?.trim() || null;
    const rowIssues: CatalogueIssue[] = [];
    if (conversion) {
      rowIssues.push({ legacyId, name, code: "unit_conversion_proposed", detail: conversion.detail });
    }
    if (derivedRaw != null && derivedRaw < 0) {
      rowIssues.push({
        legacyId,
        name,
        code: "negative_derived_stock",
        detail: `Derived historical sum is ${derivedRaw}. It is shown as-is and was not clamped.`,
      });
    }
    if (derivedRaw != null && !Number.isInteger(derivedRaw) && !conversion) {
      rowIssues.push({
        legacyId,
        name,
        code: "fractional_stock",
        detail: `Derived historical sum is ${derivedRaw} on base unit ${rawBaseUnit || "unset"}. It was not remapped.`,
      });
    }
    if (!supplier || /^unsure$/i.test(supplier)) {
      rowIssues.push({ legacyId, name, code: "supplier_missing", detail: "Supplier is missing. No supplier was guessed." });
    }
    rowIssues.push({
      legacyId,
      name,
      code: "kc_not_in_catalogue",
      detail: "No KC max was in the catalogue. None was invented.",
    });
    issues.push(...rowIssues);
    proposals.push({
      legacyId,
      name,
      rawBaseUnit,
      proposedBaseUnit: conversion?.unit ?? rawBaseUnit,
      conversionFactor: conversion?.factor ?? null,
      packs: packsFrom(cells),
      supplier: supplier && !/^unsure$/i.test(supplier) ? supplier : null,
      reorderRaw,
      derivedRaw,
      derivedProposed: conversion && derivedRaw != null ? derivedRaw * conversion.factor : null,
      kcMax: null,
      siteLinksProposed: [],
      checklistLinkProposed: null,
      issues: rowIssues,
    });
  }
  return { activeCount, skippedInactive, proposals, issues, writes: 0 };
}

/** Synthetic rows only. Real catalogue IDs stay out of the public repo. */
export const SYNTHETIC_CATALOGUE = [
  "legacyId,name,active,baseUnit,baseUnitNote,opt1Name,opt1PerBase,opt1Supplier,opt1LeadDays,opt2Name,opt2PerBase,opt2Supplier,opt2LeadDays,reorderThreshold,derivedLegacyDeltaSum_NOT_RECONCILED",
  "sample-cups,Sample cups,TRUE,sleeve,50 cups,box of 1000,20,Sample Supply,5,,,,,20,34",
  "sample-lids,Sample lids,TRUE,sleeve,100 lids,box of 1000,10,Sample Supply,5,,,,,10,21",
  "sample-concentrate,Sample concentrate,TRUE,bottle,1 L,box of 4,4,Sample Roaster,5,bottle,1,Sample Roaster,5,6,-0.004",
  "sample-spice,Sample spice syrup,TRUE,bottle,1 L,pack of 6,6,Unsure,5,bottle,1,Unsure,5,3,-4",
  "sample-disposable,Sample disposable cups,TRUE,box,500,box of 500,1,Sample Shop,2,,,,,2,4.5",
  "sample-spice-short,Broken spice row,TRUE,bottle,1 L,pack,6,Unsure,5,bottle,1,Unsure,5,-4",
].join("\n");
