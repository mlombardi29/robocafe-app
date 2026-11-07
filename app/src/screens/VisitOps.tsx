import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, set } from "idb-keyval";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { trainingContent } from "../content/trainingContent";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { dupontGuidance, kcInstruction, kcLines, photoAuditRequired, shotsForLabels } from "../lib/opsRules";
import { compressPhoto } from "../lib/photoFile";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

type FlagRow = { id: string; site_id: string; sku_id: string | null; status: "low" | "out"; resolved_at: string | null };
type SkuRow = { id: string; name: string; base_unit: string | null; source: string | null; is_sandbox: boolean };
type SiteSku = { site_id: string; sku_id: string; target_level: number | null; kc_max: number | null; kc_warn: number | null };
type ShotRow = {
  id: string;
  session_id: string;
  shot_key: string;
  shot_label: string;
  storage_state: string;
  review_status: string;
  drive_file_id: string | null;
  person_id: string;
  site_id: string;
};
type Tx = { sku_id: string; site_id: string | null; location: string; delta_base: number; is_sandbox: boolean };

function missingTable(error: unknown): boolean {
  const row = error as { message?: string; code?: string } | null;
  return turnedOff(row, "photo_audit") || turnedOff(row, "stock_flags") || turnedOff(row, "schema cache") || turnedOff(row, "does not exist");
}

export function useOpenFlags(siteId: string) {
  return useQuery({
    queryKey: ["flags", siteId],
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_flags")
        .select("id, site_id, sku_id, status, resolved_at")
        .eq("site_id", siteId)
        .is("resolved_at", null);
      if (error) throw new Error(error.message);
      return (data ?? []) as FlagRow[];
    },
  });
}

export function FlagButtons({ siteId, skuId }: { siteId: string; skuId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  async function flag(status: "low" | "out" | "clear") {
    setError("");
    const { error: rpcError } = await supabase.rpc("set_stock_flag", {
      p_site: siteId,
      p_sku: skuId,
      p_status: status,
      p_key: crypto.randomUUID(),
    });
    if (rpcError) setError(turnedOff(rpcError, "set_stock_flag") ? NOT_TURNED_ON : rpcError.message);
    else await queryClient.invalidateQueries({ queryKey: ["flags", siteId] });
  }
  return (
    <div className="mt-2">
      <div className="grid grid-cols-3 gap-2">
        <Button tone="quiet" onClick={() => void flag("low")}>Low</Button>
        <Button tone="quiet" onClick={() => void flag("out")}>Out</Button>
        <Button tone="quiet" onClick={() => void flag("clear")}>Restocked</Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function SiteGuidance({ siteId }: { siteId: string }) {
  const flags = useOpenFlags(siteId);
  const skus = useQuery({
    queryKey: ["sku-sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, name, base_unit, source, is_sandbox");
      if (error) throw new Error(error.message);
      return (data ?? []) as SkuRow[];
    },
  });
  const levels = useQuery({
    queryKey: ["site-skus", siteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_skus").select("site_id, sku_id, target_level, kc_max, kc_warn").eq("site_id", siteId);
      if (error) throw new Error(error.message);
      return (data ?? []) as SiteSku[];
    },
  });
  const stock = useQuery({
    queryKey: ["stock", siteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_tx").select("sku_id, site_id, location, delta_base, is_sandbox").eq("site_id", siteId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Tx[];
    },
  });
  if (missingTable(flags.error) || missingTable(skus.error)) {
    return <p className="mt-2 text-sm text-stone-600">Stop-at-Dupont guidance is not turned on yet.</p>;
  }
  const source = new Map((skus.data ?? []).map((row) => [row.id, row.source]));
  const onHand = new Map<string, number>();
  for (const row of stock.data ?? []) onHand.set(row.sku_id, (onHand.get(row.sku_id) ?? 0) + Number(row.delta_base));
  const guide = dupontGuidance({
    openFlags: (flags.data ?? []).map((row) => ({ skuId: row.sku_id ?? "", source: source.get(row.sku_id ?? "") ?? null, status: row.status })),
    levels: (levels.data ?? []).map((row) => ({
      skuId: row.sku_id,
      source: source.get(row.sku_id) ?? null,
      onHand: onHand.get(row.sku_id) ?? 0,
      target: row.target_level,
    })),
  });
  return (
    <div className="mt-2">
      <p className={`text-sm font-semibold ${guide.stop ? "text-amber-800" : "text-stone-700"}`}>{guide.detail}</p>
      <p className="text-sm text-stone-500">Usage forecast is not calculated. This uses open flags and a saved target only.</p>
      {guide.stop ? <Link to={`/pickup/${siteId}`} className="mt-1 inline-block text-sm font-semibold text-[var(--accent)]">Pickup list</Link> : null}
    </div>
  );
}

export function VisitOps({
  siteId,
  sessionId,
  modelCode,
  doneSkuIds,
}: {
  siteId: string;
  sessionId: string | null;
  modelCode: string;
  doneSkuIds: string[];
}) {
  const flags = useOpenFlags(siteId);
  const skus = useQuery({
    queryKey: ["sku-sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, name, base_unit, source, is_sandbox");
      if (error) throw new Error(error.message);
      return (data ?? []) as SkuRow[];
    },
  });
  const names = new Map((skus.data ?? []).map((row) => [row.id, row.name]));
  return (
    <div className="mt-4 grid gap-3">
      {(flags.data ?? []).length > 0 ? (
        <div className="rounded-2xl bg-amber-100 px-3 py-3 text-sm font-semibold text-stone-900">
          Open stock flags: {(flags.data ?? []).map((row) => `${names.get(row.sku_id ?? "") ?? "Item"} ${row.status}`).join(", ")}
        </div>
      ) : null}
      {missingTable(flags.error) ? <p className="text-sm text-stone-600">Stock flags are not turned on yet.</p> : null}
      <PhotoCapture siteId={siteId} sessionId={sessionId} modelCode={modelCode} />
      <KcPanel siteId={siteId} sessionId={sessionId} doneSkuIds={doneSkuIds} />
    </div>
  );
}

function PhotoCapture({ siteId, sessionId, modelCode }: { siteId: string; sessionId: string | null; modelCode: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const labels = trainingContent.photos[modelCode as keyof typeof trainingContent.photos] ?? [];
  const shots = shotsForLabels(labels);
  const saved = useQuery({
    queryKey: ["photo-audit", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("photo_audit_shots").select("id, session_id, shot_key, shot_label, storage_state, review_status, drive_file_id, person_id, site_id").eq("session_id", sessionId!);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as ShotRow[];
    },
  });
  const prior = useQuery({
    queryKey: ["photo-ok", siteId],
    enabled: Boolean(siteId),
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("photo_audit_shots").select("session_id, review_status, storage_state, site_id").eq("site_id", siteId);
      if (queryError) throw new Error(queryError.message);
      const rows = (data ?? []) as { session_id: string; review_status: string; storage_state: string }[];
      const bySession = new Map<string, { ok: number }>();
      for (const row of rows) {
        const current = bySession.get(row.session_id) ?? { ok: 0 };
        if (row.review_status === "ok" && row.storage_state === "stored") current.ok += 1;
        bySession.set(row.session_id, current);
      }
      return [...bySession.values()].filter((row) => row.ok === 7).length;
    },
  });
  if (!sessionId) return null;
  if (missingTable(saved.error)) return <p className="text-sm text-stone-600">Photo audit is not turned on yet. This visit is not blocked by it.</p>;
  if (!photoAuditRequired(prior.data ?? 0)) return <p className="text-sm text-stone-600">Photo audit is signed off for this kiosk.</p>;

  async function take(shotKey: string, label: string, file: File) {
    setError("");
    setNotice("");
    const blob = await compressPhoto(file);
    await set(`kioskops-photo:${sessionId}:${shotKey}`, blob);
    const { data, error: rpcError } = await supabase.rpc("register_photo_shot", {
      p_session: sessionId,
      p_shot_key: shotKey,
      p_label: label,
      p_sha: null,
      p_bytes: blob.size,
      p_key: crypto.randomUUID(),
    });
    if (rpcError) {
      setError(turnedOff(rpcError, "register_photo_shot") ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    const shot = data as { id?: string };
    const { data: auth } = await supabase.auth.getSession();
    const token = auth.session?.access_token;
    const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!token || !base) {
      setNotice("Photo saved on this phone. Drive upload is not set up yet.");
      await queryClient.invalidateQueries({ queryKey: ["photo-audit", sessionId] });
      return;
    }
    const body = new FormData();
    body.set("file", blob, `${shotKey}.jpg`);
    const response = await fetch(`${base}/functions/v1/photo-audit-upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    const payload = await response.json().catch(() => ({ configured: false }));
    if (!response.ok || !payload.configured || !payload.fileId) {
      setNotice("Photo saved on this phone. Drive upload is not set up yet.");
      await queryClient.invalidateQueries({ queryKey: ["photo-audit", sessionId] });
      return;
    }
    await supabase.rpc("mark_photo_stored", { p_id: shot.id, p_drive_file_id: payload.fileId });
    setNotice("Photo uploaded.");
    await queryClient.invalidateQueries({ queryKey: ["photo-audit", sessionId] });
  }

  return (
    <Card>
      <h2 className="font-semibold">Photo audit</h2>
      <p className="mt-1 text-sm text-stone-600">First three visits to this kiosk. Seven shots. Training reference photos are separate and still text only.</p>
      <div className="mt-3 grid gap-3">
        {shots.map((shot) => {
          const row = (saved.data ?? []).find((item) => item.shot_key === shot.key);
          return (
            <label key={shot.key} className="block text-sm">
              <span className="font-medium">{shot.label}</span>
              <span className="mt-1 block text-stone-500">{row ? `${row.storage_state === "stored" ? "In Drive" : "On this phone only"} · ${row.review_status}` : "Not taken"}</span>
              <input className="mt-1 block w-full" type="file" accept="image/*" capture="environment" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void take(shot.key, shot.label, file);
              }} />
              <LocalPhoto sessionId={sessionId!} shotKey={shot.key} />
            </label>
          );
        })}
      </div>
      {notice ? <p className="mt-2 text-sm font-medium">{notice}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function LocalPhoto({ sessionId, shotKey }: { sessionId: string; shotKey: string }) {
  const photo = useQuery({
    queryKey: ["local-photo", sessionId, shotKey],
    queryFn: async () => (await get<Blob>(`kioskops-photo:${sessionId}:${shotKey}`)) ?? null,
  });
  if (!photo.data) return null;
  const url = URL.createObjectURL(photo.data);
  return <img src={url} alt="" className="mt-2 max-h-40 rounded-2xl" />;
}

function KcPanel({ siteId, sessionId, doneSkuIds }: { siteId: string; sessionId: string | null; doneSkuIds: string[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [toMax, setToMax] = useState<Record<string, boolean>>({});
  const settings = useQuery({
    queryKey: ["site-skus", siteId],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("site_skus").select("site_id, sku_id, target_level, kc_max, kc_warn").eq("site_id", siteId);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as SiteSku[];
    },
  });
  const skus = useQuery({
    queryKey: ["sku-sources"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("skus").select("id, name, base_unit, source, is_sandbox");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as SkuRow[];
    },
  });
  if (!sessionId) return null;
  if (missingTable(settings.error)) return <p className="text-sm text-stone-600">KC Manager lines are not turned on yet.</p>;
  const lines = kcLines(doneSkuIds, (settings.data ?? []).map((row) => ({
    skuId: row.sku_id,
    name: (skus.data ?? []).find((sku) => sku.id === row.sku_id)?.name ?? "Item",
    unit: (skus.data ?? []).find((sku) => sku.id === row.sku_id)?.base_unit ?? null,
    kcMax: row.kc_max,
  })));
  if (lines.length === 0) {
    return <p className="text-sm text-stone-600">No KC Manager lines yet. They appear when a filled step is linked to an item with a saved max.</p>;
  }
  async function confirm(skuId: string, filled: boolean) {
    const quantity = typed[skuId]?.trim() ? Number(typed[skuId]) : null;
    setError("");
    const { error: rpcError } = await supabase.rpc("save_kc_confirmation", {
      p_session: sessionId,
      p_sku: skuId,
      p_filled_to_max: filled,
      p_quantity: quantity,
      p_confirmed: true,
      p_key: crypto.randomUUID(),
    });
    if (rpcError) setError(turnedOff(rpcError, "save_kc_confirmation") ? NOT_TURNED_ON : rpcError.message);
    else await queryClient.invalidateQueries({ queryKey: ["kc", sessionId] });
  }
  return (
    <Card>
      <h2 className="font-semibold">KC Manager</h2>
      <p className="mt-1 text-sm text-stone-600">Enter each line, then tick that you typed it. Warn levels are admin notes and are not a second confirmation.</p>
      {lines.map((line) => {
        const filled = toMax[line.skuId] !== false;
        return (
          <div key={line.skuId} className="mt-3">
            <p className="font-medium">{line.name}</p>
            <p className="text-sm text-stone-700">{kcInstruction(line, filled, typed[line.skuId]?.trim() ? Number(typed[line.skuId]) : null)}</p>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={filled} onChange={(event) => setToMax((current) => ({ ...current, [line.skuId]: event.target.checked }))} />
              Filled to the top
            </label>
            {filled ? null : (
              <input className={`${inputClass} mt-2`} inputMode="decimal" placeholder="Quantity" value={typed[line.skuId] ?? ""} onChange={(event) => setTyped((current) => ({ ...current, [line.skuId]: event.target.value }))} />
            )}
            <Button className="mt-2" tone="quiet" onClick={() => void confirm(line.skuId, filled)}>Entered in KC Manager</Button>
          </div>
        );
      })}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

export function FlagsPage() {
  const { profile } = useAuth();
  const sites = useQuery({ queryKey: ["sites", profile?.id, profile?.mode], queryFn: loadSites });
  const skus = useQuery({
    queryKey: ["sku-sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, name, base_unit, source, is_sandbox").eq("active", true);
      if (error) throw new Error(error.message);
      return (data ?? []) as SkuRow[];
    },
  });
  const [siteId, setSiteId] = useState("");
  const [skuId, setSkuId] = useState("");
  const flags = useOpenFlags(siteId);
  const practice = profile?.mode === "practice" || profile?.role === "trainee";
  const visibleSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const visibleSkus = (skus.data ?? []).filter((sku) => sku.is_sandbox === practice);
  return (
    <Screen>
      <Link to="/" className="text-sm font-semibold text-[var(--accent)]">Home</Link>
      <Title sub="Low or Out only. One tap here, or on a linked step during a visit.">Flag stock</Title>
      {missingTable(skus.error) ? <p className="text-sm text-stone-600">{NOT_TURNED_ON}</p> : null}
      <Field label="Kiosk">
        <select className={inputClass} value={siteId} onChange={(event) => setSiteId(event.target.value)}>
          <option value="">Choose</option>
          {visibleSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
        </select>
      </Field>
      <Field label="Item">
        <select className={inputClass} value={skuId} onChange={(event) => setSkuId(event.target.value)}>
          <option value="">Choose</option>
          {visibleSkus.map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
        </select>
      </Field>
      {siteId && skuId ? <FlagButtons siteId={siteId} skuId={skuId} /> : null}
      {siteId && (flags.data ?? []).length > 0 ? (
        <ul className="mt-4 grid gap-2 text-sm">
          {(flags.data ?? []).map((row) => <li key={row.id}>{visibleSkus.find((sku) => sku.id === row.sku_id)?.name ?? "Item"} · {row.status}</li>)}
        </ul>
      ) : null}
    </Screen>
  );
}

export function PickupPage() {
  const { siteId = "" } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState("");
  const keys = useRef<Record<string, string>>({});
  const flags = useOpenFlags(siteId);
  const skus = useQuery({
    queryKey: ["sku-sources"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("skus").select("id, name, base_unit, source, is_sandbox").eq("active", true);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as SkuRow[];
    },
  });
  const dupont = (skus.data ?? []).filter((sku) => sku.source === "dupont");
  const listed = new Set((flags.data ?? []).map((row) => row.sku_id).filter((id): id is string => Boolean(id) && dupont.some((sku) => sku.id === id)));
  if (extra) listed.add(extra);

  async function take(skuId: string) {
    const amount = Number(qty[skuId] || "1");
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter how many you are taking.");
      return;
    }
    setError("");
    setBusy(skuId);
    if (!keys.current[skuId]) keys.current[skuId] = crypto.randomUUID();
    const { error: rpcError } = await supabase.rpc("record_dupont_pickup", {
      p_sku: skuId,
      p_for_site: siteId,
      p_qty: amount,
      p_note: "Pickup",
      p_key: keys.current[skuId],
    });
    setBusy("");
    if (rpcError) setError(turnedOff(rpcError, "record_dupont_pickup") ? NOT_TURNED_ON : rpcError.message);
    else {
      delete keys.current[skuId];
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    }
  }

  return (
    <Screen>
      <Link to="/" className="text-sm font-semibold text-[var(--accent)]">Home</Link>
      <Title sub="Ticks reduce the Dupont count once. Taking the same save again does not take it twice.">Dupont pickup</Title>
      {missingTable(flags.error) ? <p className="text-sm text-stone-600">{NOT_TURNED_ON}</p> : null}
      <div className="grid gap-3">
        {[...listed].map((skuId) => (
          <Card key={skuId}>
            <p className="font-semibold">{dupont.find((sku) => sku.id === skuId)?.name ?? "Item"}</p>
            <input className={`${inputClass} mt-2`} inputMode="decimal" placeholder="1" value={qty[skuId] ?? ""} onChange={(event) => setQty((current) => ({ ...current, [skuId]: event.target.value }))} />
            <Button className="mt-2" disabled={busy === skuId} onClick={() => void take(skuId)}>Take from Dupont</Button>
          </Card>
        ))}
      </div>
      <Field label="Also take another Dupont item">
        <select className={inputClass} value={extra} onChange={(event) => setExtra(event.target.value)}>
          <option value="">Choose</option>
          {dupont.map((sku) => <option key={sku.id} value={sku.id}>{sku.name}</option>)}
        </select>
      </Field>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function PhotoReviewPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const shots = useQuery({
    queryKey: ["photo-review"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("photo_audit_shots")
        .select("id, session_id, shot_key, shot_label, storage_state, review_status, drive_file_id, person_id, site_id")
        .order("created_at", { ascending: false })
        .limit(40);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as ShotRow[];
    },
  });
  async function review(id: string, status: "ok" | "redo") {
    setError("");
    const { error: rpcError } = await supabase.rpc("review_photo_shot", { p_id: id, p_status: status, p_note: null });
    if (rpcError) setError(turnedOff(rpcError, "review_photo_shot") ? NOT_TURNED_ON : rpcError.message);
    else await queryClient.invalidateQueries({ queryKey: ["photo-review"] });
  }
  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="OK or redo. A photo that is only on the tech's phone cannot be reviewed.">Photo audit</Title>
      {missingTable(shots.error) ? <p className="text-sm text-stone-600">{NOT_TURNED_ON}</p> : null}
      <div className="grid gap-3">
        {(shots.data ?? []).map((shot) => (
          <Card key={shot.id}>
            <p className="font-semibold">{shot.shot_label}</p>
            <p className="text-sm text-stone-600">{shot.storage_state === "stored" ? "In Drive" : "On the phone only. Drive is not set up."} · {shot.review_status}</p>
            {shot.storage_state === "stored" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button onClick={() => void review(shot.id, "ok")}>OK</Button>
                <Button tone="quiet" onClick={() => void review(shot.id, "redo")}>Redo</Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
