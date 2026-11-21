/**
 * Checks the private catalogue file when KIOSKOPS_CATALOGUE_CSV is set.
 * The file is not copied into the repo. With the variable unset, this exits 0.
 * Run: KIOSKOPS_CATALOGUE_CSV=/path/to.csv npx tsx scripts/catalogue-preview-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { previewCatalogue } from "../app/src/lib/cataloguePreview.ts";

const path = process.env.KIOSKOPS_CATALOGUE_CSV;
if (!path) {
  console.log("Private catalogue check skipped.");
  process.exit(0);
}
if (!existsSync(path)) {
  console.error("Private catalogue file is missing.");
  process.exit(1);
}
const preview = previewCatalogue(readFileSync(path, "utf8"));
const failed: string[] = [];
if (preview.writes !== 0) failed.push("writes");
if (preview.activeCount !== 31) failed.push(`active ${preview.activeCount}`);
if (!preview.proposals.some((row) => (row.derivedRaw ?? 0) < 0)) failed.push("no negative derived stock");
if (!preview.issues.some((issue) => issue.code === "ambiguous_columns")) failed.push("short row was not flagged");
if (!preview.issues.some((issue) => issue.code === "negative_derived_stock")) failed.push("negative stock was not flagged");
if (!preview.issues.some((issue) => issue.code === "fractional_stock")) failed.push("fractional stock was not flagged");
if (!preview.proposals.every((row) => row.kcMax === null && row.siteLinksProposed.length === 0 && row.checklistLinkProposed === null)) failed.push("a KC max or site link was invented");
if (!preview.proposals.some((row) => row.rawBaseUnit.toLowerCase() === "sleeve" && row.conversionFactor === 50 && row.derivedProposed === (row.derivedRaw ?? 0) * 50)) failed.push("cup conversion");
if (!preview.proposals.some((row) => row.rawBaseUnit.toLowerCase() === "sleeve" && row.conversionFactor === 100)) failed.push("lid conversion");
if (preview.proposals.some((row) => /pumpkin/i.test(row.name))) failed.push("pumpkin row was parsed");
if (!preview.issues.some((issue) => /pumpkin/i.test(issue.name) && issue.code === "ambiguous_columns")) failed.push("pumpkin row was not held back");
if (!preview.proposals.some((row) => /disposable/i.test(row.name) && row.issues.some((issue) => issue.code === "fractional_stock") && row.derivedProposed === null)) failed.push("disposable cups were remapped");
if (failed.length > 0) {
  console.error(failed.join("; "));
  process.exit(1);
}
console.log(`Private catalogue preview: ${preview.activeCount} active, ${preview.issues.length} discrepancies, writes 0.`);
