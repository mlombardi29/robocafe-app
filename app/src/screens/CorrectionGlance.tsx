import type { CorrectionGlance } from "../lib/correctionGlance";

export function CorrectionGlanceView({
  glance,
  who,
  reason,
  status,
}: {
  glance: CorrectionGlance;
  who?: string;
  reason: string;
  status?: string;
}) {
  const statusLabel = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : status === "pending" ? "Waiting" : "";
  const wantedWhen = glance.timesChanged
    ? `${glance.wantedDay === glance.currentDay ? "" : `${glance.wantedDay} · `}${glance.wantedRange}`
    : "Same times";
  return (
    <div>
      {who ? <p className="font-semibold">{who}</p> : null}
      {statusLabel ? <p className="text-sm font-semibold text-stone-500">{statusLabel}</p> : null}
      <p className="text-sm text-stone-600">{glance.currentDay}</p>
      <p className="mt-2 text-base">Charged <span className="font-semibold">{glance.currentDuration}</span></p>
      <p className="text-sm text-stone-700">{glance.currentRange}</p>
      <p className="mt-2 text-base">Wants <span className="font-semibold">{glance.wantedDuration}</span></p>
      <p className="text-sm text-stone-700">{wantedWhen}</p>
      <p className="mt-2 text-xl font-semibold">{glance.delta}</p>
      <p className="mt-2 text-sm leading-relaxed text-stone-800">{reason}</p>
    </div>
  );
}
