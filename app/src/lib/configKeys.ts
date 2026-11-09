/** Allowlisted public.config keys for the admin Settings screen (E22). */

export type ConfigKeySpec = {
  key: string;
  label: string;
  help: string;
  editable: boolean;
};

/** Safe keys only — no notification recipients, secrets, or sender addresses. */
export const CONFIG_KEY_SPECS: ConfigKeySpec[] = [
  {
    key: "uoft_before_opening",
    label: "UofT Monday before-opening flag",
    help: "Legacy red flag. Keep off — open-hours servicing is allowed; soft lunch hint is on each site.",
    editable: true,
  },
  {
    key: "quiz_pass_percent",
    label: "Quiz pass percent",
    help: "Score needed to pass a model quiz.",
    editable: true,
  },
  {
    key: "quiz_draft",
    label: "Quiz draft mode",
    help: "When on, quiz answers are treated as draft.",
    editable: true,
  },
  {
    key: "coverage_pay_rule",
    label: "Coverage pay rule",
    help: "How covered shifts are paid. Read-only here.",
    editable: false,
  },
  {
    key: "reimbursement_approval_limit",
    label: "Reimbursement approval limit",
    help: "Blank means no dollar cap until you set one.",
    editable: true,
  },
  {
    key: "milk_stock_entry_rule",
    label: "Milk stock entry rule",
    help: "How milk bag stock is entered after a visit.",
    editable: false,
  },
  {
    key: "milk_stock_under_500ml_rule",
    label: "Milk under 500 mL rule",
    help: "What to do when remaining milk is under 500 mL.",
    editable: false,
  },
  {
    key: "servicing_ops_facts_migration",
    label: "Servicing migration stamp",
    help: "Which servicing migration is recorded as applied.",
    editable: false,
  },
  {
    key: "coverage_charges_migration",
    label: "Coverage/charges migration stamp",
    help: "Which coverage/charges migration is recorded as applied.",
    editable: false,
  },
];

export const CONFIG_EDITABLE_KEYS = new Set(CONFIG_KEY_SPECS.filter((row) => row.editable).map((row) => row.key));

export function isEditableConfigKey(key: string): boolean {
  return CONFIG_EDITABLE_KEYS.has(key);
}
