import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

type Sku = { id: string; name: string; base_unit: string | null; is_sandbox: boolean };
type Tx = { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean };
type SiteSku = { site_id: string; sku_id: string; low_threshold: number | null };

export function InventoryPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [skuId, setSkuId] = useState("");
  const [place, setPlace] = useState("");
  const [action, setAction] = useState("add");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [lowSite, setLowSite] = useState("");
  const [lowSku, setLowSku] = useState("");
  const [low, setLow] = useState("");
  const [kcMax, setKcMax] = useState("");
  const [kcWarn, setKcWarn] = useState("");
  const [linkItem, setLinkItem] = useState("");
  const [linkSku, setLinkSku] = useState("");
  const [held, setHeld] = useState("");

  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const skus = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("skus").select("id, name, base_unit, is_sandbox").eq("active", true).order("name");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Sku[];
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
  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const missing = turnedOff(skus.error as { message?: string } | null, "skus") || turnedOff(txs.error as { message?: string } | null, "location");

  function onHand(id: string, site: string): number {
    return (txs.data ?? [])
      .filter((row) => row.sku_id === id && row.is_sandbox === practice && (site === "dupont" ? row.location === "dupont" : row.site_id === site))
      .reduce((sum, row) => sum + Number(row.delta_base), 0);
  }

  async function addSku() {
    if (!name.trim()) {
      setError("Name the item.");
      return;
    }
    setError("");
    const { error: insertError } = await supabase.from("skus").insert({
      name: name.trim(),
      base_unit: unit.trim() || null,
      is_sandbox: practice,
      idempotency_key: crypto.randomUUID(),
    });
    if (insertError) setError(turnedOff(insertError, "skus") ? NOT_TURNED_ON : insertError.message);
    else {
      setName("");
      setUnit("");
      await queryClient.invalidateQueries({ queryKey: ["skus"] });
    }
  }

  async function changeStock() {
    const quantity = Number(qty);
    if (!skuId || !place || !Number.isFinite(quantity)) {
      setError("Pick an item, a place, and a quantity.");
      return;
    }
    setError("");
    const { error: rpcError } = await supabase.rpc("record_stock", {
      p_sku: skuId,
      p_site: place === "dupont" ? null : place,
      p_action: action,
      p_qty: quantity,
      p_note: note,
      p_key: crypto.randomUUID(),
    });
    if (rpcError) setError(turnedOff(rpcError, "record_stock") ? NOT_TURNED_ON : rpcError.message);
    else {
      setQty("");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    }
  }

  async function saveLow() {
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
        idempotency_key: crypto.randomUUID(),
      },
      { onConflict: "site_id,sku_id" },
    );
    if (upsertError) setError(turnedOff(upsertError, "site_skus") ? NOT_TURNED_ON : upsertError.message);
    else await queryClient.invalidateQueries({ queryKey: ["site-skus"] });
  }

  async function linkStep() {
    if (!linkItem) {
      setError("Choose a checklist step.");
      return;
    }
    setError("");
    const { error: updateError } = await supabase.from("checklist_items").update({ sku_id: linkSku || null }).eq("id", linkItem);
    if (updateError) setError(turnedOff(updateError, "sku_id") ? NOT_TURNED_ON : updateError.message);
    else await queryClient.invalidateQueries({ queryKey: ["checklist-link"] });
  }

  async function preview() {
    setError("");
    setHeld("");
    const { data, error: rpcError } = await supabase.rpc("preview_reorder", { p_day: null });
    if (rpcError) {
      setError(turnedOff(rpcError, "preview_reorder") ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    const row = data as { held?: number; sent?: boolean };
    setHeld(`${row.held ?? 0} held. Email was not sent.`);
  }

  return (
    <Screen>
      <Link to={admin ? "/admin" : "/"} className="text-sm font-semibold text-[var(--accent)]">{admin ? "Admin" : "Home"}</Link>
      <Title sub={practice ? "Practice stock. Live counts stay untouched." : "Live stock. Dupont is the warehouse. A site is what is there."}>Stock</Title>
      {missing ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <Card>
        <h2 className="font-semibold">Add, take, or recount one item</h2>
        <Field label="Item">
          <select className={inputClass} value={skuId} onChange={(event) => setSkuId(event.target.value)}>
            <option value="">Choose</option>
            {visibleSkus.map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
          </select>
        </Field>
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
        <Field label="Quantity">
          <input className={inputClass} inputMode="decimal" placeholder="Blank" value={qty} onChange={(event) => setQty(event.target.value)} />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        {skuId ? <p className="mb-3 text-sm text-stone-600">On hand here: {onHand(skuId, place)}{visibleSkus.find((sku) => sku.id === skuId)?.base_unit ? ` ${visibleSkus.find((sku) => sku.id === skuId)?.base_unit}` : ""}</p> : null}
        <Button onClick={() => void changeStock()}>Save</Button>
      </Card>
      {admin ? (
        <Card className="mt-4">
          <h2 className="font-semibold">New item</h2>
          <p className="mt-1 text-sm text-stone-600">Name it. Do not invent a starting count.</p>
          <Field label="Name"><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Unit"><input className={inputClass} placeholder="Blank" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
          <Button onClick={() => void addSku()}>Add item</Button>
          <h2 className="mt-5 font-semibold">Reorder level</h2>
          <p className="mt-1 text-sm text-stone-600">Leave blank until you decide a number. Blank does not create a reorder.</p>
          <Field label="Site">
            <select className={inputClass} value={lowSite} onChange={(event) => setLowSite(event.target.value)}>
              <option value="">Choose</option>
              {modeSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
            </select>
          </Field>
          <Field label="Item">
            <select className={inputClass} value={lowSku} onChange={(event) => setLowSku(event.target.value)}>
              <option value="">Choose</option>
              {visibleSkus.map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
            </select>
          </Field>
          <Field label="Reorder below">
            <input className={inputClass} inputMode="decimal" placeholder="Blank" value={low} onChange={(event) => setLow(event.target.value)} />
          </Field>
          <Field label="KC Manager max">
            <input className={inputClass} inputMode="decimal" placeholder="Blank until you set it" value={kcMax} onChange={(event) => setKcMax(event.target.value)} />
          </Field>
          <Field label="KC Manager warn">
            <input className={inputClass} inputMode="decimal" placeholder="Blank until you set it" value={kcWarn} onChange={(event) => setKcWarn(event.target.value)} />
          </Field>
          <Button onClick={() => void saveLow()}>Save level</Button>
          <h2 className="mt-5 font-semibold">Link a step to an item</h2>
          <p className="mt-1 text-sm text-stone-600">Until a step is linked, it has no Low/Out buttons and no KC line. Nothing is linked for you.</p>
          {steps.error ? <p className="text-sm text-stone-600">{NOT_TURNED_ON}</p> : null}
          <Field label="Checklist step">
            <select className={inputClass} value={linkItem} onChange={(event) => setLinkItem(event.target.value)}>
              <option value="">Choose</option>
              {(steps.data ?? []).map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>
          </Field>
          <Field label="Item">
            <select className={inputClass} value={linkSku} onChange={(event) => setLinkSku(event.target.value)}>
              <option value="">None</option>
              {visibleSkus.map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
            </select>
          </Field>
          <Button tone="quiet" onClick={() => void linkStep()}>Save link</Button>
          <Button className="mt-3" tone="quiet" onClick={() => void preview()}>Check what would be reordered</Button>
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
