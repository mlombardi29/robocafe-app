import { Link } from "react-router-dom";
import type { WarehouseRow } from "../lib/stockGlance";
import { locationStatusLabel } from "../lib/stockGlance";
import { Button } from "../ui";

export type LocationGlance = { id: string; name: string; status: "ok" | "low" | "out" };

export function ReorderBanner({ items }: { items: { id: string; name: string; amount: string }[] }) {
  if (items.length === 0) return null;
  return (
    <Link to="/inventory/dupont" className="mb-4 block rounded-3xl bg-red-700 p-4 text-white shadow-sm">
      <p className="text-sm font-bold uppercase tracking-wide">Reorder</p>
      <ul className="mt-2 grid gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-lg font-semibold leading-snug">
            {item.name}
            <span className="block text-base font-medium text-red-100">{item.amount}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

export function StockGlanceView({
  locations,
  dupontStatus,
  lowCount,
  reorderItems,
}: {
  locations: LocationGlance[];
  dupontStatus: "ok" | "reorder";
  lowCount: number;
  reorderItems: { id: string; name: string; amount: string }[] | null;
}) {
  return (
    <>
      {reorderItems ? <ReorderBanner items={reorderItems} /> : null}
      <section className="grid gap-2">
        {locations.map((location) => (
          <div key={location.id} className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 shadow-sm ring-1 ring-black/5">
            <span className="text-lg font-semibold">{location.name}</span>
            <span className={`text-base font-bold ${location.status === "out" ? "text-red-700" : location.status === "low" ? "text-amber-800" : "text-emerald-800"}`}>
              {locationStatusLabel(location.status)}
            </span>
          </div>
        ))}
        <Link to="/inventory/dupont" className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 shadow-sm ring-1 ring-black/5">
          <span className="text-lg font-semibold">Dupont</span>
          <span className={`text-base font-bold ${dupontStatus === "reorder" ? "text-red-700" : "text-emerald-800"}`}>
            {dupontStatus === "reorder" ? "Reorder" : "OK"}
          </span>
        </Link>
      </section>
      <div className="mt-4 grid gap-3">
        <Link to="/inventory/dupont" className="flex min-h-16 items-center justify-between rounded-3xl bg-[var(--accent)] px-4 text-lg font-semibold text-white">
          <span>Dupont warehouse</span>
          <span aria-hidden="true">›</span>
        </Link>
        <Link to="/inventory/low" className="flex min-h-16 items-center justify-between rounded-3xl bg-white px-4 text-lg font-semibold shadow-sm ring-1 ring-black/5">
          <span>Low or out</span>
          <span className="text-base text-stone-600">{lowCount === 0 ? "None" : `${lowCount}`}</span>
        </Link>
      </div>
    </>
  );
}

export function WarehouseListView({
  rows,
  busyId,
  onStep,
  onSave,
}: {
  rows: (WarehouseRow & { draft: number })[];
  busyId: string;
  onStep: (skuId: string, delta: number) => void;
  onSave: (skuId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const dirty = row.draft !== 0;
        return (
          <section key={row.skuId} className={`rounded-3xl p-4 shadow-sm ring-1 ${row.reorder ? "bg-red-50 ring-red-700" : "bg-white ring-black/5"}`}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold leading-snug">{row.name}</h2>
              {row.reorder ? <span className="shrink-0 rounded-full bg-red-700 px-2 py-0.5 text-xs font-bold text-white">Reorder</span> : null}
            </div>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{row.amount}</p>
            <div className="mt-3 grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2">
              <button
                type="button"
                className="min-h-16 rounded-2xl bg-white text-3xl font-semibold text-stone-900 ring-1 ring-stone-200"
                aria-label={`Less ${row.name}`}
                onClick={() => onStep(row.skuId, -1)}
              >
                −
              </button>
              <p className="text-center text-sm font-medium text-stone-600">{dirty ? "Not saved" : `1 ${row.step.name}`}</p>
              <button
                type="button"
                className="min-h-16 rounded-2xl bg-[var(--accent)] text-3xl font-semibold text-white"
                aria-label={`More ${row.name}`}
                onClick={() => onStep(row.skuId, 1)}
              >
                +
              </button>
            </div>
            {dirty ? (
              <Button className="mt-3 w-full" disabled={busyId === row.skuId} onClick={() => onSave(row.skuId)}>
                {busyId === row.skuId ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </section>
        );
      })}
      {rows.length === 0 ? <p className="text-stone-600">No warehouse items.</p> : null}
    </div>
  );
}

export function LowOutListView({ rows }: { rows: { id: string; place: string; item: string; status: "low" | "out" }[] }) {
  if (rows.length === 0) return <p className="text-stone-600">Nothing is low or out.</p>;
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 shadow-sm ring-1 ring-black/5">
          <span>
            <span className="block text-lg font-semibold">{row.item}</span>
            <span className="text-sm text-stone-600">{row.place}</span>
          </span>
          <span className={`text-base font-bold ${row.status === "out" ? "text-red-700" : "text-amber-800"}`}>
            {locationStatusLabel(row.status)}
          </span>
        </div>
      ))}
    </div>
  );
}
