/**
 * Reads checklists/*.yaml and writes:
 *   supabase/migrations/0003_seed_content.sql
 *   supabase/migrations/0004_sandbox.sql
 *   app/src/content/trainingContent.ts
 *
 * Run from app/: npm run gen:seed
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { parse } = require("yaml") as { parse: (src: string) => unknown };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EN = "\u2013";

const ARM_SENSOR_DETAILS =
  "Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see.";

type Item = {
  key: string;
  title: string;
  details?: string;
  cadence: string;
  days?: number;
  required?: boolean;
  blocks_clean_start?: boolean;
  locked_during_clean?: boolean;
  status?: string;
};

type Section = { phase: string; title: string; items: Item[] };
type ModelFile = {
  code: string;
  name: string;
  milk_clean_minutes: number;
  sections: Section[];
};

type QuizQ = { prompt: string; choices: string[]; answer: number; explanation: string };
type QuizFile = { draft: boolean; pass_percent: number; models: Record<string, QuizQ[]> };
type TrainingFile = { draft: boolean; photo_shots?: string[]; photos?: Record<string, string[]>; why: Record<string, string> };

const CADENCE_DAYS: Record<string, number | null> = {
  every_visit: null,
  every_n_days: null,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  below_threshold: null,
  check_decide: null,
};

function sqlStr(value: string | null | undefined): string {
  if (value == null || value === "") return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlJson(value: unknown): string {
  return `${sqlStr(JSON.stringify(value))}::jsonb`;
}

function load<T>(name: string): T {
  return parse(readFileSync(resolve(root, "checklists", name), "utf8")) as T;
}

function cadenceDays(item: Item): number | null {
  if (item.cadence === "every_n_days") {
    if (!item.days || item.days < 1) throw new Error(`${item.key} needs days`);
    return item.days;
  }
  if (!(item.cadence in CADENCE_DAYS)) throw new Error(`Unknown cadence ${item.cadence}`);
  return CADENCE_DAYS[item.cadence];
}

const models = ["s35.yaml", "s22.yaml", "s5.yaml"].map((name) => load<ModelFile>(name));
const quiz = load<QuizFile>("quiz.yaml");
const training = load<TrainingFile>("training.yaml");

if (quiz.draft !== true) throw new Error("quiz.yaml must stay draft: true until Michael reviews it");
if (quiz.pass_percent !== 80) throw new Error("pass mark is 80");

for (const model of models) {
  const keys = new Set<string>();
  for (const section of model.sections) {
    for (const item of section.items) {
      if (keys.has(item.key)) throw new Error(`Duplicate key ${model.code}/${item.key}`);
      keys.add(item.key);
      if (item.details && item.details.trim().toLowerCase() === item.title.trim().toLowerCase()) {
        throw new Error(`Details restate the title: ${model.code}/${item.key}`);
      }
    }
  }
  const questions = quiz.models[model.code];
  if (!questions || questions.length < 8 || questions.length > 12) {
    throw new Error(`${model.code} needs 8–12 quiz questions`);
  }
  for (const q of questions) {
    if (q.answer < 0 || q.answer >= q.choices.length) throw new Error(`Bad answer index: ${q.prompt}`);
  }
  const why = training.why[model.code];
  if (!why || why.trim().length < 40) throw new Error(`Missing why card for ${model.code}`);
}

const s35 = models.find((m) => m.code === "s35")!;
const s22 = models.find((m) => m.code === "s22")!;
const s5 = models.find((m) => m.code === "s5")!;
const sensor = (m: ModelFile) => m.sections.flatMap((s) => s.items).find((i) => i.key === "arm_sensor");
if (sensor(s35)?.details !== ARM_SENSOR_DETAILS || sensor(s35)?.status !== "pending_validation") {
  throw new Error("Sinai arm sensor placeholder changed");
}
if (sensor(s5)?.details !== ARM_SENSOR_DETAILS || sensor(s5)?.status !== "pending_validation") {
  throw new Error("RBC arm sensor placeholder changed");
}
if (sensor(s22)) throw new Error("UofT must not have an arm sensor step");
const keysOf = (m: ModelFile) => new Set(m.sections.flatMap((s) => s.items.map((i) => i.key)));
for (const banned of ["grey_water", "claw", "door_check", "cleaning_balls", "empty_pucks"]) {
  if (keysOf(s22).has(banned)) throw new Error(`UofT must not include ${banned}`);
}
if (keysOf(s35).has("grey_water")) throw new Error("Sinai has no grey water");
if (!keysOf(s5).has("grey_water") || !keysOf(s5).has("door_check")) {
  throw new Error("RBC is missing grey water or the door check");
}

const liveSites = [
  {
    name: "Mount Sinai Hospital",
    short: "Sinai",
    model: "s35",
    serial: "TLCQP24370000062",
    cadence: "daily",
    active: true,
  },
  {
    name: `UofT Sidney Smith ${EN} Sid's Cafe`,
    short: "UofT",
    model: "s22",
    serial: "TKCQP25770200028",
    cadence: "mwf",
    active: true,
  },
  {
    name: `RBC Amphitheatre ${EN} Bud Stage`,
    short: "RBC",
    model: "s5",
    serial: "TLCQP23090200051",
    cadence: "show_days",
    active: false,
  },
];

const practiceSites = [
  { name: `PRACTICE ${EN} Sinai (3.5)`, short: "PRACTICE Sinai", model: "s35", cadence: "daily" },
  { name: `PRACTICE ${EN} UofT (2.2)`, short: "PRACTICE UofT", model: "s22", cadence: "mwf" },
  { name: `PRACTICE ${EN} RBC (S5)`, short: "PRACTICE RBC", model: "s5", cadence: "show_days" },
];

function siteInsert(
  site: { name: string; short: string; model: string; serial?: string; cadence: string; active: boolean },
  sandbox: boolean,
): string {
  return `insert into public.sites (name, short_name, model_id, serial, cadence, opening_time, active, is_sandbox)
select ${sqlStr(site.name)}, ${sqlStr(site.short)}, m.id, ${sqlStr(site.serial ?? null)}, ${sqlStr(site.cadence)}, null, ${site.active ? "true" : "false"}, ${sandbox ? "true" : "false"}
from public.models m where m.code = ${sqlStr(site.model)};
`;
}

function contentInserts(list: ModelFile[]): string {
  const lines: string[] = [];
  for (const model of list) {
    lines.push(
      `insert into public.checklist_templates (model_id, version, published, label)
select m.id, 1, true, ${sqlStr(`${model.name} v1`)}
from public.models m where m.code = ${sqlStr(model.code)};
`,
    );
    model.sections.forEach((section, sectionIndex) => {
      lines.push(
        `insert into public.checklist_sections (template_id, position, title, phase)
select t.id, ${sectionIndex}, ${sqlStr(section.title)}, ${sqlStr(section.phase)}
from public.checklist_templates t
join public.models m on m.id = t.model_id
where m.code = ${sqlStr(model.code)} and t.version = 1;
`,
      );
      section.items.forEach((item, itemIndex) => {
        const days = cadenceDays(item);
        lines.push(
          `insert into public.checklist_items (
  section_id, position, key, title, details, required, cadence_type, cadence_days,
  locked_during_clean, blocks_clean_start, status
)
select s.id, ${itemIndex}, ${sqlStr(item.key)}, ${sqlStr(item.title)}, ${sqlStr(item.details ?? null)},
  ${item.required === false ? "false" : "true"}, ${sqlStr(item.cadence)}, ${days == null ? "null" : days},
  ${item.locked_during_clean ? "true" : "false"}, ${item.blocks_clean_start ? "true" : "false"},
  ${sqlStr(item.status ?? "active")}
from public.checklist_sections s
join public.checklist_templates t on t.id = s.template_id
join public.models m on m.id = t.model_id
where m.code = ${sqlStr(model.code)} and t.version = 1 and s.position = ${sectionIndex};
`,
        );
      });
    });
  }
  return lines.join("\n");
}

function quizInserts(): string {
  const lines: string[] = [];
  for (const [code, questions] of Object.entries(quiz.models)) {
    questions.forEach((q, index) => {
      lines.push(
        `insert into public.quiz_questions (model_id, position, prompt, choices, answer_index, explanation, draft)
select m.id, ${index + 1}, ${sqlStr(q.prompt)}, ${sqlJson(q.choices)}, ${q.answer}, ${sqlStr(q.explanation)}, true
from public.models m where m.code = ${sqlStr(code)};
`,
      );
    });
  }
  return lines.join("\n");
}

function settingsInsert(sandbox: boolean): string {
  return `insert into public.site_item_settings (site_id, item_id, threshold_value, threshold_unit, enabled)
select s.id, i.id, null, null, true
from public.sites s
join public.models m on m.id = s.model_id
join public.checklist_templates t on t.model_id = m.id and t.published
join public.checklist_sections sec on sec.template_id = t.id
join public.checklist_items i on i.section_id = sec.id
where s.is_sandbox = ${sandbox ? "true" : "false"}
  and i.cadence_type = 'below_threshold';
`;
}

function rulesInsert(sites: { name: string; cadence: string }[]): string {
  return sites
    .map(
      (site) => `insert into public.schedule_rules (site_id, rule, due_before_opening)
select s.id, ${sqlStr(site.cadence)}, false
from public.sites s where s.name = ${sqlStr(site.name)};
`,
    )
    .join("\n");
}

const stateReseed = `-- Weekly arm steps are 8 days old so they show as due.
-- Milk bag is 5 days old (due). Puck bin is 3 days old (overdue).
-- Deep cleans were done 3 days ago so they stay off this practice visit.
insert into public.site_item_state (site_id, item_id, last_done_at, is_sandbox)
select s.id, i.id,
  case i.key
    when 'milk_bag' then now() - interval '5 days'
    when 'empty_pucks' then now() - interval '3 days'
    when 'arm_calibration' then now() - interval '8 days'
    when 'arm_sensor' then now() - interval '8 days'
    when 'deep_clean_nozzles' then now() - interval '3 days'
    when 'deep_clean_fridges' then now() - interval '3 days'
  end,
  true
from public.sites s
join public.models m on m.id = s.model_id
join public.checklist_templates t on t.model_id = m.id and t.published
join public.checklist_sections sec on sec.template_id = t.id
join public.checklist_items i on i.section_id = sec.id
where s.is_sandbox
  and i.key in ('milk_bag', 'empty_pucks', 'arm_calibration', 'arm_sensor', 'deep_clean_nozzles', 'deep_clean_fridges');
`;

const showReseed = `insert into public.show_days (site_id, date, show_start_time, status, is_sandbox)
select s.id, current_date, time '18:00', 'scheduled', true
from public.sites s where s.name = ${sqlStr(practiceSites[2].name)}
union all
select s.id, current_date + 3, time '19:00', 'scheduled', true
from public.sites s where s.name = ${sqlStr(practiceSites[2].name)}
union all
select s.id, current_date + 10, time '17:30', 'scheduled', true
from public.sites s where s.name = ${sqlStr(practiceSites[2].name)};
`;

const header = `-- Generated by scripts/gen-seed.ts from checklists/*.yaml.
-- Do not edit by hand. Do not put PINs, codes, or keys in this file.
-- opening_time is null on purpose: the UofT Monday red flag stays off until an opening time is known.
`;

const sql003 = `${header}
insert into public.models (code, name, milk_clean_minutes) values
${models
  .map((model) => {
    if (!Number.isInteger(model.milk_clean_minutes) || model.milk_clean_minutes < 1) {
      throw new Error(`${model.code} needs a milk cleaning time in minutes`);
    }
    return `  (${sqlStr(model.code)}, ${sqlStr(model.name)}, ${model.milk_clean_minutes})`;
  })
  .join(",\n")};

${liveSites.map((site) => siteInsert({ ...site }, false)).join("\n")}
${contentInserts(models)}
${quizInserts()}
${rulesInsert(liveSites)}
${settingsInsert(false)}
insert into public.config (key, value) values
  ('quiz_pass_percent', '80'),
  ('quiz_draft', 'true'),
  ('uoft_before_opening', 'off'),
  ('arm_sensor_criteria', 'pending_albert_kim');
`;

const practiceInserts = practiceSites
  .map((site) => siteInsert({ ...site, serial: undefined, active: true }, true))
  .join("\n");

const sql004 = `${header}
-- Practice sites. Real RBC stays inactive (offline since Oct 15 2026). These are active so training can use them.

${practiceInserts}
${rulesInsert(practiceSites)}
${settingsInsert(true)}
${stateReseed}
${showReseed}

create or replace function public.reset_sandbox()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not allowed.';
  end if;

  delete from public.service_item_completions where is_sandbox;
  delete from public.time_corrections where is_sandbox;
  delete from public.service_sessions where is_sandbox;
  delete from public.site_item_state where is_sandbox;
  delete from public.show_days where is_sandbox;

  ${stateReseed}
  ${showReseed}
end;
$$;

revoke all on function public.reset_sandbox() from public, anon;
grant execute on function public.reset_sandbox() to authenticated;
`;

const trainingTs = `// Generated by scripts/gen-seed.ts. Do not edit by hand.
// Quiz questions live in the database. This file is the training "why" card and the photo list.

export const trainingContent = ${JSON.stringify(
  {
    draft: true,
    passPercent: 80,
    photos: {
      s35: training.photos?.s35 ?? training.photo_shots ?? [],
      s22: training.photos?.s22 ?? training.photo_shots ?? [],
      s5: training.photos?.s5 ?? training.photo_shots ?? [],
    },
    why: {
      s35: training.why.s35.trim(),
      s22: training.why.s22.trim(),
      s5: training.why.s5.trim(),
    },
  },
  null,
  2,
)} as const;
`;

mkdirSync(resolve(root, "app/src/content"), { recursive: true });
writeFileSync(resolve(root, "supabase/migrations/0003_seed_content.sql"), sql003);
writeFileSync(resolve(root, "supabase/migrations/0004_sandbox.sql"), sql004);
writeFileSync(resolve(root, "app/src/content/trainingContent.ts"), trainingTs);
console.log("Wrote 0003_seed_content.sql, 0004_sandbox.sql, and trainingContent.ts");
