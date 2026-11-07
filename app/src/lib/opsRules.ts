/** Rules for the Nov 6 ops batch. No network. */

export const PHOTO_SHOT_KEYS = ["overall", "cleaning", "beans", "powders", "cups", "closed", "spouts"] as const;

export type PhotoShotKey = (typeof PHOTO_SHOT_KEYS)[number];

export function shotsForLabels(labels: readonly string[]): { key: PhotoShotKey; label: string }[] {
  return PHOTO_SHOT_KEYS.map((key, index) => ({ key, label: labels[index] ?? key }));
}

/** First three reviewed visits to this kiosk. A later visit does not ask again. */
export function photoAuditRequired(okVisitsAtSite: number): boolean {
  return okVisitsAtSite < 3;
}

/** Only an explicit snapshot flag requires photos. A missing field is an older visit. */
export function photoAuditRequiredBySnapshot(snapshot: { photo_audit?: { required?: boolean } } | null | undefined): boolean {
  return snapshot?.photo_audit?.required === true;
}

export function fitWithin(width: number, height: number, max = 1600): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type FlagStatus = "low" | "out";

export function dupontGuidance(input: {
  openFlags: { skuId: string; source: string | null; status: FlagStatus }[];
  levels: { skuId: string; source: string | null; onHand: number; target: number | null }[];
}): { stop: boolean; detail: string } {
  const flagged = input.openFlags.filter((row) => row.source === "dupont");
  if (flagged.length > 0) {
    return {
      stop: true,
      detail: "Stop at Dupont first. A Dupont item is flagged Low or Out at this kiosk.",
    };
  }
  const short = input.levels.filter((row) => row.source === "dupont" && row.target != null && row.onHand < row.target);
  if (short.length > 0) {
    return {
      stop: true,
      detail: "Stop at Dupont first. On-site stock is below a saved target.",
    };
  }
  return {
    stop: false,
    detail: "Go straight to servicing. No Dupont item is flagged, and no saved target is short.",
  };
}

export type KcSetting = {
  skuId: string;
  name: string;
  unit: string | null;
  kcMax: number | null;
};

/** Lines only for items marked done that have a saved KC max. Not needed items are skipped. */
export function kcLines(doneSkuIds: string[], settings: KcSetting[]): KcSetting[] {
  const wanted = new Set(doneSkuIds);
  return settings.filter((row) => row.kcMax != null && wanted.has(row.skuId));
}

export function kcInstruction(setting: KcSetting, filledToMax: boolean, typed: number | null): string {
  const unit = setting.unit ? ` ${setting.unit}` : "";
  if (filledToMax) {
    return setting.kcMax == null
      ? "Tap To Container Max Size in KC Manager."
      : `Tap To Container Max Size in KC Manager (${setting.kcMax}${unit}).`;
  }
  if (typed == null) return "Type the quantity you will enter in KC Manager.";
  return `Type ${typed}${unit} into Consumable Quantity in KC Manager.`;
}
