import { useMemo, useState } from "react";
import { groupPickerSkus, listCategories, toggleFavourite, type PickerSku } from "../lib/skuPicker";
import { inputClass } from "../ui";

export function SkuPickList({
  label,
  skus,
  value,
  recentIds,
  favouriteIds,
  onFavouriteChange,
  onChange,
}: {
  label: string;
  skus: PickerSku[];
  value: string;
  recentIds: string[];
  favouriteIds: string[];
  onFavouriteChange: (ids: string[]) => void;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = useMemo(() => listCategories(skus), [skus]);
  const sections = useMemo(
    () => groupPickerSkus(skus, { query, favouriteIds, recentIds, category }),
    [skus, query, favouriteIds, recentIds, category],
  );
  const selected = skus.find((sku) => sku.id === value) ?? null;

  return (
    <div className="mb-4">
      <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>
      <input
        className={inputClass}
        value={query}
        placeholder="Search items"
        onChange={(event) => setQuery(event.target.value)}
      />
      {categories.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${category === "" ? "bg-[var(--accent)] text-white" : "bg-stone-100 text-stone-700"}`}
            onClick={() => setCategory("")}
          >
            All
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${category === name ? "bg-[var(--accent)] text-white" : "bg-stone-100 text-stone-700"}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl bg-stone-50 px-3 py-2 text-sm">
          <span className="font-medium">{selected.name}</span>
          <button
            type="button"
            className="shrink-0 text-sm font-semibold text-[var(--accent)]"
            onClick={() => onFavouriteChange(toggleFavourite(typeof localStorage === "undefined" ? null : localStorage, selected.id))}
          >
            {favouriteIds.includes(selected.id) ? "Unfavourite" : "Favourite"}
          </button>
        </div>
      ) : null}
      <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-stone-200 p-2">
        {sections.length === 0 ? <p className="px-2 py-1 text-sm text-stone-500">No matching items.</p> : null}
        {sections.map((section) => (
          <div key={section.key}>
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{section.title}</p>
            <div className="mt-1 grid gap-1">
              {section.items.map((sku) => (
                <button
                  key={sku.id}
                  type="button"
                  className={`min-h-11 rounded-xl px-3 text-left text-sm ${value === sku.id ? "bg-[var(--accent)] text-white" : "bg-white text-stone-800 hover:bg-stone-50"}`}
                  onClick={() => onChange(sku.id)}
                >
                  {sku.name}
                  {sku.base_unit ? <span className={value === sku.id ? " opacity-80" : " text-stone-500"}> · {sku.base_unit}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
