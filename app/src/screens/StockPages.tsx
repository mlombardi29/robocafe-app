import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import {
  dupontGlanceStatus,
  locationStockStatus,
  nextWarehouseCount,
  toWarehouseRow,
  type WarehouseRow,
} from "../lib/stockGlance";
import { supabase } from "../lib/supabase";
import { ErrorText, Screen, Title } from "../ui";
import { FlagStockPanel } from "./VisitOps";
import { LowOutListView, StockGlanceView, WarehouseListView } from "./stockViews";

type SkuRow = {
  id: string;
  name: string;
  base_unit: string | null;
  source: string | null;
  reorder_threshold: number | null;
  target_level: number | null;
  phase_out: boolean | null;
  is_sandbox: boolean;
};
type PackRow = { sku_id: string; name: string; per_base: number; is_sandbox: boolean };
type TxRow = { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean };
type FlagRow = { id: string; site_id: string; sku_id: string | null; status: "low" | "out"; resolved_at: string | null; is_sandbox: boolean };

function useStockBundle() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";
  const sites = useQuery({ queryKey: ["sites", profile?.id, profile?.mode], enabled: Boolean(profile), queryFn: loadSites });
  const skus = useQuery({
    queryKey: ["skus-glance"],
    queryFn: async () => {
      const full = await supabase
        .from("skus")
        .select("id, name, base_unit, source, reorder_threshold, target_level, phase_out, is_sandbox")
        .eq("active", true)
        .order("name");
      if (!full.error) return (full.data ?? []) as SkuRow[];
      const base = await supabase.from("skus").select("id, name, base_unit, source, reorder_threshold, is_sandbox").eq("active", true).order("name");
      if (base.error) throw new Error(base.error.message);
      return ((base.data ?? []) as SkuRow[]).map((row) => ({ ...row, target_level: null, phase_out: false }));
    },
  });
  const packs = useQuery({
    queryKey: ["sku-packs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_packs").select("sku_id, name, per_base, is_sandbox");
      if (error) return [] as PackRow[];
      return (data ?? []) as PackRow[];
    },
  });
  const txs = useQuery({
    queryKey: ["stock"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_tx").select("sku_id, site_id, location, delta_base, is_sandbox");
      if (error) throw new Error(error.message);
      return (data ?? []) as TxRow[];
    },
  });
  const flags = useQuery({
    queryKey: ["flags-all", practice],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_flags")
        .select("id, site_id, sku_id, status, resolved_at, is_sandbox")
        .is("resolved_at", null)
        .eq("is_sandbox", practice);
      if (error) return [] as FlagRow[];
      return (data ?? []) as FlagRow[];
    },
  });
  return { profile, practice, admin, sites, skus, packs, txs, flags };
}

function warehouseRows(skus: SkuRow[], packs: PackRow[], txs: TxRow[], practice: boolean): WarehouseRow[] {
  return skus
    .filter((sku) => sku.is_sandbox === practice && sku.source !== "grocery")
    .map((sku) => {
      const onHand = txs
        .filter((row) => row.is_sandbox === practice && row.sku_id === sku.id && row.location === "dupont")
        .reduce((sum, row) => sum + Number(row.delta_base), 0);
      return toWarehouseRow({
        skuId: sku.id,
        name: sku.name,
        baseUnit: sku.base_unit,
        onHand,
        reorderBelow: sku.reorder_threshold == null ? null : Number(sku.reorder_threshold),
        phaseOut: Boolean(sku.phase_out),
        packs: packs
          .filter((pack) => pack.sku_id === sku.id && pack.is_sandbox === practice)
          .map((pack) => ({ name: pack.name, perBase: Number(pack.per_base) })),
      });
    })
    .sort((a, b) => Number(b.reorder) - Number(a.reorder) || a.name.localeCompare(b.name));
}

export function StockHomePage() {
  const bundle = useStockBundle();
  const visibleSites = (bundle.sites.data ?? []).filter((site) => site.is_sandbox === bundle.practice && site.active);
  const rows = useMemo(
    () => warehouseRows(bundle.skus.data ?? [], bundle.packs.data ?? [], bundle.txs.data ?? [], bundle.practice),
    [bundle.skus.data, bundle.packs.data, bundle.txs.data, bundle.practice],
  );
  const flags = bundle.flags.data ?? [];
  const locations = visibleSites.map((site) => ({
    id: site.id,
    name: site.short_name,
    status: locationStockStatus(flags.filter((flag) => flag.site_id === site.id)),
  }));
  const reorder = rows.filter((row) => row.reorder).map((row) => ({ id: row.skuId, name: row.name, amount: row.amount }));
  return (
    <Screen>
      <Title sub={bundle.practice ? "Practice stock. Live counts stay untouched." : "Low, out, or OK at each place. Dupont is the warehouse."}>Stock</Title>
      {bundle.sites.isLoading ? <p className="mb-3 text-stone-600">Loading…</p> : null}
      <StockGlanceView
        locations={locations}
        dupontStatus={dupontGlanceStatus(rows)}
        lowCount={flags.length}
        reorderItems={bundle.admin ? reorder : null}
      />
      <div className="mt-5">
        <FlagStockPanel />
      </div>
      {bundle.admin ? (
        <Link to="/inventory/setup" className="mt-4 inline-block text-base font-semibold text-[var(--accent)]">Item setup</Link>
      ) : null}
      <Link to={bundle.admin ? "/admin/stock-history" : "/stock-history"} className="mt-3 block text-base font-semibold text-[var(--accent)]">
        Stock history
      </Link>
    </Screen>
  );
}

export function WarehousePage() {
  const bundle = useStockBundle();
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const saved = useMemo(
    () => warehouseRows(bundle.skus.data ?? [], bundle.packs.data ?? [], bundle.txs.data ?? [], bundle.practice),
    [bundle.skus.data, bundle.packs.data, bundle.txs.data, bundle.practice],
  );
  const rows = saved.map((row) => {
    const draft = steps[row.skuId] ?? 0;
    const onHand = nextWarehouseCount(row.onHand, draft, row.step.perBase);
    const shown = toWarehouseRow({ ...row, onHand });
    return { ...shown, draft };
  });

  function step(skuId: string, delta: number) {
    const row = saved.find((item) => item.skuId === skuId);
    if (!row) return;
    setSteps((current) => {
      const now = current[skuId] ?? 0;
      const nextSteps = now + delta;
      const before = nextWarehouseCount(row.onHand, now, row.step.perBase);
      const after = nextWarehouseCount(row.onHand, nextSteps, row.step.perBase);
      if (delta < 0 && after === before) return current;
      return { ...current, [skuId]: nextSteps };
    });
  }

  async function save(skuId: string) {
    const row = rows.find((item) => item.skuId === skuId);
    const savedRow = saved.find((item) => item.skuId === skuId);
    if (!row || !savedRow || row.draft === 0) return;
    const next = nextWarehouseCount(savedRow.onHand, row.draft, savedRow.step.perBase);
    setBusy(skuId);
    setError("");
    const { error: rpcError } = await supabase.rpc("record_stock", {
      p_sku: skuId,
      p_site: null,
      p_action: "recount",
      p_qty: next,
      p_note: "Warehouse recount",
      p_key: crypto.randomUUID(),
    });
    setBusy("");
    if (rpcError) {
      setError(turnedOff(rpcError, "record_stock") ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    setSteps((current) => ({ ...current, [skuId]: 0 }));
    await queryClient.invalidateQueries({ queryKey: ["stock"] });
  }

  return (
    <Screen>
      <Link to="/inventory" className="text-sm font-semibold text-[var(--accent)]">Stock</Link>
      <Title sub="Minus or plus one pack, then Save. Each save is a recount on the stock history.">Dupont</Title>
      {bundle.admin ? (
        <p className="mb-3 text-sm text-stone-600">Items at or below reorder, or at zero, are marked Reorder.</p>
      ) : null}
      <WarehouseListView rows={rows} busyId={busy} onStep={step} onSave={(id) => void save(id)} />
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function LowOutPage() {
  const bundle = useStockBundle();
  const sites = new Map((bundle.sites.data ?? []).map((site) => [site.id, site.short_name]));
  const names = new Map((bundle.skus.data ?? []).map((sku) => [sku.id, sku.name]));
  const rows = (bundle.flags.data ?? []).map((flag) => ({
    id: flag.id,
    place: sites.get(flag.site_id) ?? "Location",
    item: flag.sku_id ? names.get(flag.sku_id) ?? "Item" : "Item",
    status: flag.status,
  }));
  return (
    <Screen>
      <Link to="/inventory" className="text-sm font-semibold text-[var(--accent)]">Stock</Link>
      <Title sub="Every item flagged low or out. Status only.">Low or out</Title>
      <LowOutListView rows={rows} />
    </Screen>
  );
}

export function useReorderBanner(): { id: string; name: string; amount: string }[] {
  const bundle = useStockBundle();
  return useMemo(() => {
    if (!bundle.admin) return [];
    return warehouseRows(bundle.skus.data ?? [], bundle.packs.data ?? [], bundle.txs.data ?? [], bundle.practice)
      .filter((row) => row.reorder)
      .map((row) => ({ id: row.skuId, name: row.name, amount: row.amount }));
  }, [bundle.admin, bundle.skus.data, bundle.packs.data, bundle.txs.data, bundle.practice]);
}
