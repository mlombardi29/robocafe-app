/**
 * Evidence-backed old → current step interpretation.
 * Only 1:1 clear equivalents get a current_key. Splits/merges/changed/retired
 * stay history_only. Mapping never invents synonyms from similar names alone.
 *
 * Even clear equivalents preserve the original payload and are history-readable,
 * not transfer-ready proof that today's expanded checklist was satisfied.
 */

export type StepInterpretationKind = "equivalent" | "history_only";

export type StepInterpretation = {
  legacyItemId: string;
  kind: StepInterpretationKind;
  /** Set only for clear 1:1 equivalents. */
  currentKey: string | null;
  /** Why this reading is (or is not) equivalent. */
  explanation: string;
  /** Short evidence note (labels / identity). */
  evidence: string;
};

/** Clear 1:1 only. Do not add merge/split pairs here. */
const EQUIVALENT: Record<string, Omit<StepInterpretation, "legacyItemId" | "kind">> = {
  powder_clean: {
    currentKey: "powder_clean",
    explanation: "Same step id and same powder-cleaning action.",
    evidence: "Exact id powder_clean; legacy label cleans powder dispenser/components.",
  },
  powder_fill: {
    currentKey: "powder_fill",
    explanation: "Same step id and same powder fill action.",
    evidence: "Exact id powder_fill; legacy label fills canister and returns spout.",
  },
  bb_hands: {
    currentKey: "gloves",
    explanation: "Same hand-wash and gloves action as today's gloves step.",
    evidence: "Legacy label “Wash your hands and put on gloves” matches current gloves title.",
  },
  final_test: {
    currentKey: "test_drink",
    explanation: "Same end-of-visit test drink action.",
    evidence: "Legacy label is the test drink; current key test_drink.",
  },
  kiosoft_record: {
    currentKey: "kc_consumables",
    explanation: "Same consumables update in the manager app (Kiosoft renamed to KC Manager).",
    evidence: "Legacy “Update the consumables in the Kiosoft Servicing app” ↔ kc_consumables.",
  },
  graywater_empty: {
    currentKey: "grey_water",
    explanation: "Same gray/grey water empty action (spelling variant).",
    evidence: "Legacy graywater_empty label empties gray water; current grey_water on S5.",
  },
  scale_200: {
    currentKey: "scale_check",
    explanation: "Same scale 200 g check.",
    evidence: "Legacy “Confirm the scale measures properly at 200 grams” ↔ scale_check.",
  },
  cameo_beans: {
    currentKey: "fill_beans",
    explanation: "Same bean fill/check action.",
    evidence: "Legacy “Check coffee beans and fill as required” ↔ fill_beans.",
  },
  cameo_puck: {
    currentKey: "empty_pucks",
    explanation: "Same puck drawer empty action.",
    evidence: "Legacy “Empty the coffee puck drawer” ↔ empty_pucks.",
  },
  arm_claw: {
    currentKey: "claw",
    explanation: "Same delicate claw wipe.",
    evidence: "Legacy “Very gently wipe down the claw” ↔ Clean Robot Claw (delicately).",
  },
  cameo_wipe: {
    currentKey: "wipe_cameo",
    explanation: "Same Cameo/coffee-machine wipe.",
    evidence: "Legacy “Wipe the coffee machine as needed” ↔ wipe_cameo.",
  },
  cameo_bag: {
    currentKey: "milk_bag",
    explanation: "Same milk bag change-when-needed action.",
    evidence: "Legacy “Complete a bag change if needed” ↔ milk_bag.",
  },
};

const HISTORY_ONLY: Record<string, Omit<StepInterpretation, "legacyItemId" | "kind" | "currentKey">> = {
  milk_clean: {
    explanation:
      "Old single “perform milk cleaning” step does not equal today's separate Long Water Pour + Start milk cleaning sequence.",
    evidence: "Changed/split relative to start_milk_clean and long_water.",
  },
  syrup_clean: {
    explanation: "Old syrup clean is only part of today's combined syrup cleaning and top-ups step.",
    evidence: "Split/merge: syrup_clean + syrup_check → syrup; not 1:1.",
  },
  syrup_check: {
    explanation: "Old syrup refill check is only part of today's combined syrup step.",
    evidence: "Split/merge with syrup_clean; not 1:1.",
  },
  cups_fill: {
    explanation: "Old cups-only fill is half of today's combined cups and lids step.",
    evidence: "Split/merge: cups_fill + lids_fill → cups_lids.",
  },
  lids_fill: {
    explanation: "Old lids-only fill is half of today's combined cups and lids step.",
    evidence: "Split/merge with cups_fill; not 1:1.",
  },
  clean_glass: {
    explanation: "Glass wipe could map to glass or wipe_cameo; not uniquely equivalent.",
    evidence: "Ambiguous between glass and wipe_cameo.",
  },
  clean_surfaces: {
    explanation: "General surface wipe is not the same as a single current glass/Cameo step.",
    evidence: "Ambiguous/changed wording vs glass / wipe_cameo.",
  },
  powder_remove: {
    explanation: "Canister remove is a sub-step of today's powder clean/fill flow, not its own current key.",
    evidence: "Split into powder_clean / powder_fill process.",
  },
  powder_flush: {
    explanation: "Powder flush API clean is folded into today's powder cleaning instructions.",
    evidence: "Split/changed into powder_clean details.",
  },
  powder_check: {
    explanation: "Rare “check powder levels” label is not clearly the same as powder_fill alone.",
    evidence: "Ambiguous vs powder_fill.",
  },
  arm_setup: {
    explanation: "Part of today's multi-step arm calibration procedure, not the whole step.",
    evidence: "Split: arm_setup + arm_weight + arm_park → arm_calibration.",
  },
  arm_weight: {
    explanation: "Weight read/recalibrate is only part of today's arm calibration procedure.",
    evidence: "Split into arm_calibration; also differs from approved Auto Calibrate wording.",
  },
  arm_park: {
    explanation: "Parking the arm is a sub-step, not a standalone current checklist key.",
    evidence: "Split into arm_calibration flow.",
  },
  sensor_hot: {
    explanation: "Sensor positions are a multi-step check; current arm_sensor criteria still pending confirmation.",
    evidence: "Split + pending_validation arm_sensor.",
  },
  sensor_cold: {
    explanation: "Sensor positions are a multi-step check; current arm_sensor criteria still pending confirmation.",
    evidence: "Split + pending_validation arm_sensor.",
  },
  sensor_green: {
    explanation: "“Solid green” pass rule is not confirmed in today's arm_sensor placeholder.",
    evidence: "Changed/unconfirmed vs pending_validation arm_sensor.",
  },
  sensor_clean: {
    explanation: "Sensor cleaning is part of the old multi-step sensor check, not a confirmed current key.",
    evidence: "Split + pending_validation arm_sensor.",
  },
  milk_fill_oat: {
    explanation: "Oat-only top-up is half of today's combined 2% and oat top-up (where both apply).",
    evidence: "Split/merge into milk_topup.",
  },
  milk_fill_2: {
    explanation: "2%-only top-up is not a full match to combined milk_topup on all models.",
    evidence: "Split/merge into milk_topup.",
  },
  milk_fill: {
    explanation: "Generic 2% fill label overlaps milk_fill_2 / milk_topup without a unique 1:1.",
    evidence: "Ambiguous duplicate of milk_fill_2 vs milk_topup.",
  },
  cameo_balls: {
    explanation: "Old “check cleaning balls” is narrower than today's add/replace cracked-balls rule.",
    evidence: "Changed/expanded requirements on cleaning_balls.",
  },
  garbage_cups: {
    explanation: "Cup garbage only is half of today's combined garbage step.",
    evidence: "Split/merge: garbage_cups + garbage_drinks → garbage.",
  },
  garbage_drinks: {
    explanation: "Drink garbage only is half of today's combined garbage step.",
    evidence: "Split/merge with garbage_cups; not 1:1.",
  },
  bb_hotwater: {
    explanation: "Filling hot-water containers has no dedicated current checklist key.",
    evidence: "Retired / not present in current YAML keys.",
  },
  arm_home1: {
    explanation: "Home Door 1 positioning is not a current checklist key.",
    evidence: "Retired/sub-step of old arm cleaning.",
  },
  arm_wipe: {
    explanation: "General arm wipe is not the claw-specific current step.",
    evidence: "Ambiguous vs claw; not 1:1.",
  },
  arm_homedoor2: {
    explanation: "Home Door 2 positioning is not a current checklist key.",
    evidence: "Retired/sub-step of old arm cleaning.",
  },
  cc_clean: {
    explanation: "Concentrate clean is only part of today's coffee concentrate step.",
    evidence: "Split/merge: cc_clean + cc_fill → concentrate.",
  },
  cc_fill: {
    explanation: "Concentrate fill is only part of today's coffee concentrate step.",
    evidence: "Split/merge with cc_clean; not 1:1.",
  },
};

export function interpretLegacyStep(legacyItemId: string): StepInterpretation {
  const id = legacyItemId.trim();
  const eq = EQUIVALENT[id];
  if (eq) {
    return { legacyItemId: id, kind: "equivalent", ...eq };
  }
  const hist = HISTORY_ONLY[id];
  if (hist) {
    return { legacyItemId: id, kind: "history_only", currentKey: null, ...hist };
  }
  return {
    legacyItemId: id,
    kind: "history_only",
    currentKey: null,
    explanation: "No evidence-backed equivalence is defined for this legacy step id.",
    evidence: "Unknown legacy itemId; preserved as original history only.",
  };
}

export function listClearEquivalences(): StepInterpretation[] {
  return Object.entries(EQUIVALENT).map(([legacyItemId, value]) => ({
    legacyItemId,
    kind: "equivalent" as const,
    ...value,
  }));
}

export function listHistoryOnlyCatalog(): StepInterpretation[] {
  return Object.entries(HISTORY_ONLY).map(([legacyItemId, value]) => ({
    legacyItemId,
    kind: "history_only" as const,
    currentKey: null,
    ...value,
  }));
}
