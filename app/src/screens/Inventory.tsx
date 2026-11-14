import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { conversionLabel, onHandLabel, positivePerBase, toBaseQty, type EntryMode, type PackOption } from "../lib/packEntry";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { recentSkuIds, type PickerSku } from "../lib/skuPicker";
import { warehouseNeedsReorder, warehouseRuleLabel } from "../lib/stockRules";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";
import { SkuPickList } from "./SkuPickList";

type Sku = {
  id: string;
  name: string;
  base_unit: string | null;
  category: string | null;
  subcategory: string | null;
  source: string | null;
  reorder_threshold: number | null;
  target_level: number | null;
  phase_out: boolean | null;
  notes: string | null;
  is_sandbox: boolean;
};
type Tx = { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean };
type SiteSku = { site_id: string; sku_id: string; low_threshold: number | null };
type PackRow = { id: string; sku_id: string; name: string; per_base: number; is_sandbox: boolean };

export function InventoryPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const pendingGate = useRef(createPendingGate()).current;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [skuId, setSkuId] = useState("");
  const [place, setPlace] = useState(() => {
    try {
      return localStorage.getItem("kioskops.lastStockPlace") ?? "";
    } catch {
      return "";
    }
  });
  const [action, setAction] = useState("add");
  const [entryKind, setEntryKind] = useState<"base" | "pack">("base");
  const [packId, setPackId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [packSku, setPackSku] = useState("");
  const [packName, setPackName] = useState("");
  const [packPerBase, setPackPerBase] = useState("");
  const [lowSite, setLowSite] = useState("");
  const [lowSku, setLowSku] = useState("");
  const [low, setLow] = useState("");
  const [kcMax, setKcMax] = useState("");
  const [kcWarn, setKcWarn] = useState("");
  const [linkItem, setLinkItem] = useState("");
  const [linkSku, setLinkSku] = useState("");
  const [held, setHeld] = useState("");
  const [favouriteIds, setFavouriteIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("kioskops.skuFavourites");
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });

  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const skus = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const full = await supabase
        .from("skus")
        .select("id, name, base_unit, category, subcategory, source, reorder_threshold, target_level, phase_out, notes, is_sandbox")
        .eq("active", true)
        .order("name");
      if (!full.error) return (full.data ?? []) as Sku[];
      if (!/target_level|phase_out|notes|schema cache|does not exist/i.test(full.error.message)) {
        throw new Error(full.error.message);
      }
      const base = await supabase
        .from("skus")
        .select("id, name, base_unit, category, subcategory, source, reorder_threshold, is_sandbox")
        .eq("active", true)
        .order("name");
      if (base.error) throw new Error(base.error.message);
      return ((base.data ?? []) as Sku[]).map((row) => ({ ...row, target_level: null, phase_out: false, notes: null }));
    },
  });
  const packs = useQuery({
    queryKey: ["sku-packs"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("sku_packs").select("id, sku_id, name, per_base, is_sandbox").order("name");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as PackRow[];
    },
  });
  const txs = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("inventory_tx").select("sku_id, site_id, location, delta_base, is_sandbox");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Tx[];
    },
  });
  const steps = useQuery({
    queryKey: ["checklist-link"],
    enabled: admin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("checklist_items").select("id, title, sku_id").order("title");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as { id: string; title: string; sku_id: string | null }[];
    },
  });
  const levels = useQuery({
    queryKey: ["site-skus"],
    enabled: admin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("site_skus").select("site_id, sku_id, low_threshold");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as SiteSku[];
    },
  });

  const visibleSkus = (skus.data ?? []).filter((row) => row.is_sandbox === practice);
  const pickerSkus: PickerSku[] = visibleSkus.map((sku) => ({
    id: sku.id,
    name: sku.name,
    base_unit: sku.base_unit,
    category: sku.category,
    subcategory: sku.subcategory,
  }));
  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const selectedSku = visibleSkus.find((sku) => sku.id === skuId) ?? null;
  const recentIds = useMemo(
    () => recentSkuIds((txs.data ?? []).filter((row) => row.is_sandbox === practice).map((row) => row.sku_id)),
    [txs.data, practice],
  );
  const selectedPacks: PackOption[] = useMemo(
    () =>
      (packs.data ?? [])
        .filter((row) => row.sku_id === skuId && row.is_sandbox === practice)
        .map((row) => ({ id: row.id, name: row.name, perBase: Number(row.per_base) })),
    [packs.data, skuId, practice],
  );
  const entryMode: EntryMode = entryKind === "pack" && packId ? { kind: "pack", packId } : { kind: "base" };
  const qtyNumber = qty.trim() === "" ? NaN : Number(qty);
  const conversionPreview =
    selectedSku && Number.isFinite(qtyNumber)
      ? conversionLabel(entryMode, qtyNumber, selectedPacks, selectedSku.base_unit)
      : null;
  const missing =
    turnedOff(skus.error as { message?: string } | null, "skus") ||
    turnedOff(txs.error as { message?: string } | null, "location") ||
    turnedOff(packs.error as { message?: string } | null, "sku_packs");

  function onHand(id: string, site: string): number {
    return (txs.data ?? [])
      .filter((row) => row.sku_id === id && row.is_sandbox === practice && (site === "dupont" ? row.location === "dupont" : row.site_id === site))
      .reduce((sum, row) => sum + Number(row.delta_base), 0);
  }

  function pickSku(id: string) {
    setSkuId(id);
    setEntryKind("base");
    setPackId("");
  }

  async function addSku() {
    await runPending(pendingGate, setBusy, "add-sku", async () => {
      if (!name.trim()) {
        setError("Name the item.");
        return;
      }
      setError("");
      const { error: insertError } = await supabase.from("skus").insert({
        name: name.trim(),
        base_unit: unit.trim() || null,
        is_sandbox: practice,
      });
      if (insertError) setError(turnedOff(insertError, "skus") ? NOT_TURNED_ON : insertError.message);
      else {
        setName("");
        setUnit("");
        await queryClient.invalidateQueries({ queryKey: ["skus"] });
      }
    });
  }

  async function addPack() {
    await runPending(pendingGate, setBusy, "add-pack", async () => {
      const per = positivePerBase(packPerBase.trim() === "" ? NaN : Number(packPerBase));
      if (!packSku || !packName.trim() || per == null) {
        setError("Pick an item, name the pack, and enter how many base units it holds.");
        return;
      }
      setError("");
      const { error: insertError } = await supabase.from("sku_packs").insert({
        sku_id: packSku,
        name: packName.trim(),
        per_base: per,
        is_sandbox: practice,
      });
      if (insertError) setError(turnedOff(insertError, "sku_packs") ? NOT_TURNED_ON : insertError.message);
      else {
        setPackName("");
        setPackPerBase("");
        await queryClient.invalidateQueries({ queryKey: ["sku-packs"] });
      }
    });
  }

  async function changeStock() {
    await runPending(pendingGate, setBusy, "stock", async () => {
      const quantity = Number(qty);
      if (!skuId || !place || !Number.isFinite(quantity)) {
        setError("Pick an item, a place, and a quantity.");
        return;
      }
      if (entryKind === "pack" && !packId) {
        setError("Pick a pack size, or enter in base units.");
        return;
      }
      const baseQty = toBaseQty(entryMode, quantity, selectedPacks);
      if (baseQty == null) {
        setError("That pack size is missing or invalid.");
        return;
      }
      setError("");
      const { error: rpcError } = await supabase.rpc("record_stock", {
        p_sku: skuId,
        p_site: place === "dupont" ? null : place,
        p_action: action,
        p_qty: baseQty,
        p_note: note,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "record_stock") ? NOT_TURNED_ON : rpcError.message);
      else {
        try {
          localStorage.setItem("kioskops.lastStockPlace", place);
        } catch {
          /* ignore */
        }
        setQty("");
        setNote("");
        await queryClient.invalidateQueries({ queryKey: ["stock"] });
      }
    });
  }

  async function saveLow() {
    await runPending(pendingGate, setBusy, "low", async () => {
      const numeric = low.trim() === "" ? null : Number(low);
      if (!lowSite || !lowSku || (numeric != null && !Number.isFinite(numeric))) {
        setError("Pick a site, an item, and a reorder level, or leave the level blank.");
        return;
      }
      setError("");
      const max = kcMax.trim() === "" ? null : Number(kcMax);
      const warn = kcWarn.trim() === "" ? null : Number(kcWarn);
      if ((max != null && !Number.isFinite(max)) || (warn != null && !Number.isFinite(warn))) {
        setError("KC numbers must be blank or a number. None are filled in for you.");
        return;
      }
      const { error: upsertError } = await supabase.from("site_skus").upsert(
        {
          site_id: lowSite,
          sku_id: lowSku,
          low_threshold: numeric,
          kc_max: max,
          kc_warn: warn,
          is_sandbox: practice,
        },
        { onConflict: "site_id,sku_id" },
      );
      if (upsertError) setError(turnedOff(upsertError, "site_skus") ? NOT_TURNED_ON : upsertError.message);
      else await queryClient.invalidateQueries({ queryKey: ["site-skus"] });
    });
  }

  async function linkStep() {
    await runPending(pendingGate, setBusy, "link", async () => {
      if (!linkItem) {
        setError("Choose a checklist step.");
        return;
      }
      setError("");
      const { error: updateError } = await supabase.from("checklist_items").update({ sku_id: linkSku || null }).eq("id", linkItem);
      if (updateError) setError(turnedOff(updateError, "sku_id") ? NOT_TURNED_ON : updateError.message);
      else await queryClient.invalidateQueries({ queryKey: ["checklist-link"] });
    });
  }

  async function previewReorder() {
    await runPending(pendingGate, setBusy, "reorder-preview", async () => {
      setError("");
      setHeld("");
      const { data, error: rpcError } = await supabase.rpc("preview_reorder", { p_day: null });
      if (rpcError) {
        setError(turnedOff(rpcError, "preview_reorder") ? NOT_TURNED_ON : rpcError.message);
        return;
      }
      const row = data as { held?: number; sent?: boolean };
      setHeld(`${row.held ?? 0} held. Email was not sent.`);
    });
  }

  return (
    <Screen>
      <Link to={admin ? "/admin" : "/"} className="text-sm font-semibold text-[var(--accent)]">{admin ? "Admin" : "Home"}</Link>
      <Title sub={practice ? "Practice stock. Live counts stay untouched." : "Live stock. Dupont is the warehouse. A site is what is there."}>Stock</Title>
      <Link to={admin ? "/admin/stock-history" : "/stock-history"} className="mb-3 inline-block text-sm font-semibold text-[var(--accent)]">
        Stock history
      </Link>
      {missing ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <Card>
        <h2 className="font-semibold">Add, take, or recount one item</h2>
        <p className="mt-1 text-sm text-stone-600">
          {place ? "Place remembered — pick an item, enter quantity, save." : "Pick an item and a place, then enter quantity and save."}
        </p>
        <SkuPickList
          label="Item"
          skus={pickerSkus}
          value={skuId}
          recentIds={recentIds}
          favouriteIds={favouriteIds}
          onFavouriteChange={setFavouriteIds}
          onChange={pickSku}
        />
        <Field label="Where">
          <select className={inputClass} value={place} onChange={(event) => setPlace(event.target.value)}>
            <option value="">Choose</option>
            {admin ? <option value="dupont">Dupont</option> : null}
            {modeSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
          </select>
        </Field>
        <Field label="Action">
          <select className={inputClass} value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="add">Add</option>
            <option value="take">Take</option>
            <option value="recount">Recount</option>
          </select>
        </Field>
        <Field label="Enter as">
          <select
            className={inputClass}
            value={entryKind === "pack" ? `pack:${packId}` : "base"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "base") {
                setEntryKind("base");
                setPackId("");
                return;
              }
              setEntryKind("pack");
              setPackId(value.slice("pack:".length));
            }}
          >
            <option value="base">{selectedSku?.base_unit?.trim() || "Base units"}</option>
            {selectedPacks.map((pack) => (
              <option key={pack.id} value={`pack:${pack.id}`}>
                {pack.name} ({pack.perBase} {selectedSku?.base_unit?.trim() || "each"})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input className={inputClass} inputMode="decimal" placeholder="Blank" value={qty} onChange={(event) => setQty(event.target.value)} />
        </Field>
        {conversionPreview ? <p className="mb-3 text-sm font-medium text-stone-700">Saves as {conversionPreview}</p> : null}
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {skuId ? (
          <p className="mb-3 text-sm text-stone-600">
            On hand here: {onHandLabel(onHand(skuId, place), selectedSku?.base_unit, selectedPacks)}
          </p>
        ) : null}
        {selectedSku ? (
          <p className={`mb-3 text-sm ${selectedSku.phase_out ? "font-medium text-amber-900" : "text-stone-600"}`}>
            {selectedSku.source === "grocery"
              ? "Grocery · not warehouse stock."
              : warehouseRuleLabel({
                  reorderBelow: selectedSku.reorder_threshold == null ? null : Number(selectedSku.reorder_threshold),
                  target: selectedSku.target_level == null ? null : Number(selectedSku.target_level),
                  baseUnit: selectedSku.base_unit ?? "units",
                  packs: selectedPacks.map((pack) => ({ name: pack.name, perBase: pack.perBase })),
                  phaseOut: Boolean(selectedSku.phase_out),
                })}
            {place === "dupont" &&
            selectedSku.source === "dupont" &&
            warehouseNeedsReorder(onHand(skuId, "dupont"), selectedSku.reorder_threshold == null ? null : Number(selectedSku.reorder_threshold))
              ? " · below reorder now"
              : ""}
            {selectedSku.notes ? ` · ${selectedSku.notes}` : ""}
          </p>
        ) : null}
        <Button disabled={Boolean(busy)} onClick={() => void changeStock()}>{busy === "stock" ? "Saving…" : "Save"}</Button>
      </Card>
      {admin ? (
        <Card className="mt-4">
          <h2 className="font-semibold">New item</h2>
          <p className="mt-1 text-sm text-stone-600">Name it and its base unit. Do not invent a starting count or pack sizes.</p>
          <Field label="Name"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Base unit"><input className={inputClass} placeholder="Blank" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
          <Button disabled={Boolean(busy)} onClick={() => void addSku()}>{busy === "add-sku" ? "Saving…" : "Add item"}</Button>
          <h2 className="mt-5 font-semibold">Pack size</h2>
          <p className="mt-1 text-sm text-stone-600">Optional. Example: sleeves of 50. Terminology stays as you type it until Michael confirms names later.</p>
          <SkuPickList
            label="Item"
            skus={pickerSkus}
            value={packSku}
            recentIds={recentIds}
            favouriteIds={favouriteIds}
            onFavouriteChange={setFavouriteIds}
            onChange={setPackSku}
          />
          <Field label="Pack name"><input className={inputClass} placeholder="e.g. sleeves" value={packName} onChange={(event) => setPackName(event.target.value)} /></Field>
          <Field label="Base units per pack">
            <input className={inputClass} inputMode="decimal" placeholder="e.g. 50" value={packPerBase} onChange={(event) => setPackPerBase(event.target.value)} />
          </Field>
          <Button disabled={Boolean(busy)} onClick={() => void addPack()}>{busy === "add-pack" ? "Saving…" : "Add pack"}</Button>
          <h2 className="mt-5 font-semibold">Reorder level</h2>
          <p className="mt-1 text-sm text-stone-600">Leave blank until you decide a number. Blank does not create a reorder.</p>
          <Field label="Site">
            <select className={inputClass} value={lowSite} onChange={(event) => setLowSite(event.target.value)}>
              <option value="">Choose</option>
              {modeSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
            </select>
          </Field>
          <SkuPickList
            label="Item"
            skus={pickerSkus}
            value={lowSku}
            recentIds={recentIds}
            favouriteIds={favouriteIds}
            onFavouriteChange={setFavouriteIds}
            onChange={setLowSku}
          />
          <Field label="Reorder below">
            <input className={inputClass} inputMode="decimal" placeholder="Blank" value={low} onChange={(event) => setLow(event.target.value)} />
          </Field>
          <Field label="KC Manager max">
            <input className={inputClass} inputMode="decimal" placeholder="Blank until you set it" value={kcMax} onChange={(event) => setKcMax(event.target.value)} />
          </Field>
          <Field label="KC Manager warn">
            <input className={inputClass} inputMode="decimal" placeholder="Blank until you set it" value={kcWarn} onChange={(event) => setKcWarn(event.target.value)} />
          </Field>
          <Button disabled={Boolean(busy)} onClick={() => void saveLow()}>{busy === "low" ? "Saving…" : "Save level"}</Button>
          <h2 className="mt-5 font-semibold">Link a step to an item</h2>
          <p className="mt-1 text-sm text-stone-600">Until a step is linked, it has no Low/Out buttons and no KC line. Nothing is linked for you.</p>
          {steps.error ? <p className="text-sm text-stone-600">{NOT_TURNED_ON}</p> : null}
          <Field label="Checklist step">
            <select className={inputClass} value={linkItem} onChange={(event) => setLinkItem(event.target.value)}>
              <option value="">Choose</option>
              {(steps.data ?? []).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>
          </Field>
          <SkuPickList
            label="Item"
            skus={pickerSkus}
            value={linkSku}
            recentIds={recentIds}
            favouriteIds={favouriteIds}
            onFavouriteChange={setFavouriteIds}
            onChange={setLinkSku}
          />
          <Button tone="quiet" disabled={Boolean(busy)} onClick={() => void linkStep()}>{busy === "link" ? "Saving…" : "Save link"}</Button>
          <Button className="mt-3" tone="quiet" disabled={Boolean(busy)} onClick={() => void previewReorder()}>
            {busy === "reorder-preview" ? "Checking…" : "Check what would be reordered"}
          </Button>
          {held ? <p className="mt-2 text-sm font-medium">{held}</p> : null}
          <div className="mt-3 grid gap-1">
            {(levels.data ?? []).map((row) => (
              <p key={`${row.site_id}-${row.sku_id}`} className="text-sm text-stone-600">
                {modeSites.find((site) => site.id === row.site_id)?.short_name ?? "Site"} · {visibleSkus.find((sku) => sku.id === row.sku_id)?.name ?? "Item"} · {row.low_threshold ?? "no level"}
              </p>
            ))}
          </div>
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
