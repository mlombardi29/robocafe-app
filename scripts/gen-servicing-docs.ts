/**
 * Reads checklists/{s35,s22,s5}.yaml and writes docs/servicing/*.md.
 * Run from repo root: npx tsx scripts/gen-servicing-docs.ts
 * Or from app/: npm run gen:servicing-docs
 *
 * Does not rewrite 0003 seed history or apply migrations.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { parse } = require("yaml") as { parse: (src: string) => unknown };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Keys stamped not_needed_allowed=false on NEW visits after 0015/0016. Historical snapshots omit the flag. */
const MANDATORY_KEYS = [
  "kc_sign_in",
  "gloves",
  "maintenance_mode",
  "long_water",
  "start_milk_clean",
  "syrup",
  "powder_clean",
  "glass",
  "wipe_cameo",
  "door_check",
  "exit_maint",
  "test_drink",
] as const;

type Item = {
  key: string;
  title: string;
  details?: string;
  cadence: string;
  days?: number;
  required?: boolean;
  status?: string;
};

type Section = { phase: string; title: string; items: Item[] };
type ModelFile = {
  code: string;
  name: string;
  milk_clean_minutes: number;
  sections: Section[];
};

const CADENCE_LABEL: Record<string, string> = {
  every_visit: "Every visit",
  every_n_days: "Every N days",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  below_threshold: "When below the fill line",
  check_decide: "Check and decide",
};

function load(name: string): ModelFile {
  return parse(readFileSync(resolve(root, "checklists", name), "utf8")) as ModelFile;
}

function cadenceLabel(item: Item): string {
  if (item.cadence === "every_n_days") return `Every ${item.days} days`;
  return CADENCE_LABEL[item.cadence] ?? item.cadence;
}

function renderDetails(details: string | undefined): string {
  if (!details?.trim()) return "_No extra steps written for this item._\n";
  const blocks = details.split(/\n\n+/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines[0]?.trim() === "Additional info") {
      out.push("**Additional info**");
      out.push(...lines.slice(1).map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`));
      continue;
    }
    const numbered = lines.every((line) => /^\d+\.\s/.test(line.trim()) || !line.trim());
    if (numbered) {
      out.push(...lines.map((line) => line.trim()).filter(Boolean));
    } else {
      out.push(lines.map((line) => line.trim()).filter(Boolean).join(" "));
    }
  }
  return `${out.join("\n")}\n`;
}

function renderModel(model: ModelFile): string {
  const site =
    model.code === "s35"
      ? "Mount Sinai (Series 3.5) and PRACTICE Sinai"
      : model.code === "s22"
        ? "UofT (Series 2.2) and PRACTICE UofT"
        : "RBC Amphitheatre (S5) and PRACTICE RBC";

  const lines: string[] = [];
  lines.push(`# Servicing instructions — ${model.name}`);
  lines.push("");
  lines.push(`Model code \`${model.code}\`. Used at **${site}**.`);
  lines.push(`Milk cleaning runs about **${model.milk_clean_minutes} minutes**.`);
  lines.push("");
  lines.push("Source of truth: `checklists/" + model.code + ".yaml`. This page is generated for reading on GitHub.");
  lines.push(
    "Template text + runtime thresholds for databases that already have seed history are updated by `supabase/migrations/0016_servicing_ops_facts.sql` (apply only when approved; does not rewrite open or offline visit snapshots). Frozen `0015_servicing_feedback.sql` stays historical provenance.",
  );
  lines.push("");
  lines.push("## Read this first");
  lines.push("");
  lines.push("- Follow the section order below. Do not invent a new required sequence.");
  lines.push("- **Robot arm calibration** (Sinai and RBC only) uses the seven-step Auto Calibrate weight check (**190–210 g inclusive**). That is **not** the cup presence / arm sensor check.");
  lines.push("- **Arm sensor check**: Mount Sinai uses solid-green hot/cold criteria. At RBC mark Not needed (Sinai-only).");
  lines.push("- After migration `0016`, new visits disallow **Not needed** on the mandatory keys listed at the bottom. Older and offline snapshots without that flag stay finishable as they were.");
  lines.push("- Beans refill only below two-thirds. Powder stays below half. Kiosoft milk entry: actual added minus 500 mL (manual entry only; not a KioskOps inventory change).");
  lines.push("- No lock-box codes, fridge codes, key-card PINs, or private catalogue data belong in these instructions.");
  lines.push("");

  model.sections.forEach((section, index) => {
    lines.push(`## ${index + 1}. ${section.title}`);
    lines.push("");
    for (const item of section.items) {
      const flags: string[] = [cadenceLabel(item)];
      if (item.required !== false) flags.push("required");
      if (MANDATORY_KEYS.includes(item.key as (typeof MANDATORY_KEYS)[number])) {
        flags.push("Not needed blocked on new visits after 0016");
      }
      if (item.status === "pending_validation") flags.push("criteria pending confirmation");
      if (item.key === "arm_calibration") flags.push("Auto Calibrate weight procedure");
      if (item.key === "arm_sensor" && model.code === "s35") flags.push("Sinai solid-green criteria");
      if (item.key === "arm_sensor" && model.code === "s5") flags.push("Sinai-only — Not needed at RBC");
      lines.push(`### ${item.title}`);
      lines.push("");
      lines.push(`\`${item.key}\` · ${flags.join(" · ")}`);
      lines.push("");
      lines.push(renderDetails(item.details).trimEnd());
      lines.push("");
    }
  });

  const presentMandatory = MANDATORY_KEYS.filter((key) =>
    model.sections.some((section) => section.items.some((item) => item.key === key)),
  );
  lines.push("## Mandatory on new visits (after 0016)");
  lines.push("");
  lines.push("These keys on this model get `not_needed_allowed: false` when a **new** visit is created after `0016` is applied:");
  lines.push("");
  for (const key of presentMandatory) {
    const item = model.sections.flatMap((s) => s.items).find((i) => i.key === key)!;
    lines.push(`- \`${key}\` — ${item.title}`);
  }
  lines.push("");
  lines.push("Conditional or weekly items keep **Not needed** unless listed above.");
  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderIndex(models: ModelFile[]): string {
  return `# Servicing instructions

Human-readable servicing steps for each kiosk model. Edit \`checklists/*.yaml\` first, then regenerate these pages with \`npm run gen:servicing-docs\` from \`app/\`.

| Model | Sites | Page |
|---|---|---|
${models
  .map((m) => {
    const sites =
      m.code === "s35" ? "Mount Sinai / PRACTICE Sinai" : m.code === "s22" ? "UofT / PRACTICE UofT" : "RBC / PRACTICE RBC";
    return `| ${m.name} (\`${m.code}\`) | ${sites} | [Open](./${m.code}.md) |`;
  })
  .join("\n")}

## Canonical sources

| What | Where |
|---|---|
| Wording techs follow | \`checklists/s35.yaml\`, \`checklists/s22.yaml\`, \`checklists/s5.yaml\` |
| Greenfield seed SQL | \`npm run gen:seed\` → \`supabase/migrations/0003_seed_content.sql\` and \`0004_sandbox.sql\` (do **not** re-apply rewritten \`0003\` on a database that already ran it) |
| Current live template + thresholds candidate | \`supabase/migrations/0016_servicing_ops_facts.sql\` (on DB through 0010; does not rewrite visit snapshots) |
| Frozen historical 0015 | \`supabase/migrations/0015_servicing_feedback.sql\` (immutable; superseded for new apply by 0016) |

## Held separately

- Volumes under 500 mL when applying the Kiosoft milk entry rule are not specified — flag if a visit needs that case; do not invent handling.
- Google Doc sync and inaccessible \`shes-wired-in/certain-ventures\` manual copy — not claimed synced here.
- Applying \`0011\`–\`0014\`, hosted \`0016\`, Netlify publish, Google/Drive, and live imports/sends stay on their own approvals.
`;
}

const files = ["s35.yaml", "s22.yaml", "s5.yaml"];
const models = files.map(load);

for (const code of ["s35", "s5"] as const) {
  const model = models.find((m) => m.code === code)!;
  const sensor = model.sections.flatMap((s) => s.items).find((i) => i.key === "arm_sensor");
  if (!sensor || sensor.status === "pending_validation") {
    throw new Error(`${code} arm_sensor must not remain pending_validation after Sinai solid-green approval`);
  }
  if (code === "s35" && !sensor.details?.includes("solid green")) {
    throw new Error("s35 arm_sensor must include solid-green criteria");
  }
  if (code === "s5" && !sensor.details?.includes("Mount Sinai only")) {
    throw new Error("s5 arm_sensor must stay Sinai-only / Not needed at RBC");
  }
  const cal = model.sections.flatMap((s) => s.items).find((i) => i.key === "arm_calibration");
  if (!cal?.details?.includes("Auto Calibrate") || !cal.details.includes("190–210")) {
    throw new Error(`${code} arm_calibration must keep the approved seven-step Auto Calibrate procedure`);
  }
  if (!cal.details.includes("not the cup presence sensor")) {
    throw new Error(`${code} arm_calibration must distinguish the cup presence sensor`);
  }
}
if (models.find((m) => m.code === "s22")!.sections.flatMap((s) => s.items).some((i) => i.key === "arm_sensor")) {
  throw new Error("s22 must not include arm_sensor");
}

const outDir = resolve(root, "docs", "servicing");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "README.md"), renderIndex(models));
for (const model of models) {
  writeFileSync(resolve(outDir, `${model.code}.md`), renderModel(model));
}

const mig = readFileSync(resolve(root, "supabase", "migrations", "0015_servicing_feedback.sql"), "utf8");
const checks: Array<{ label: string; needle: string }> = [
  { label: "Long Water Pour title", needle: "Long Water Pour" },
  { label: "KCM then Maintenance Mode", needle: "Scan in with the KCM app. The options appear after that scan." },
  { label: "cracked balls", needle: "cracked, do so, or else it will damage the machine" },
  { label: "syrup all spouts OK", needle: "when syrup is visible from all spouts, press OK" },
  { label: "powder nozzles title", needle: "Clean the powder nozzles" },
  { label: "delicate claw title", needle: "Clean Robot Claw (delicately)" },
  { label: "dispensing elevators", needle: "drink dispensing elevators" },
  { label: "Auto Calibrate step", needle: "press Auto Calibrate" },
  { label: "cup sensor distinction", needle: "not the cup presence sensor" },
];
for (const { label, needle } of checks) {
  if (!mig.includes(needle)) throw new Error(`0015 missing ${label}`);
  const inYaml = models.some((m) =>
    m.sections.some((s) =>
      s.items.some((i) => (i.title?.includes(needle) ?? false) || (i.details?.includes(needle) ?? false)),
    ),
  );
  if (!inYaml && label !== "Long Water Pour title") {
    // title-only needles may appear as title
  }
  const yamlHas = models.some((m) => JSON.stringify(m).includes(needle));
  if (!yamlHas) throw new Error(`YAML missing ${label}`);
}

console.log(`Wrote ${models.length + 1} files under docs/servicing/`);
