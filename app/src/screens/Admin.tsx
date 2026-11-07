import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { correctionGlance } from "../lib/correctionGlance";
import { thresholdDetail } from "../lib/due";
import { offboardingTitles } from "../lib/offboarding";
import { supabase } from "../lib/supabase";
import type { Role, SiteRow } from "../lib/types";
import { CorrectionGlanceView } from "./CorrectionGlance";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

const sections: { title: string; links: [string, string][] }[] = [
  {
    title: "People",
    links: [
      ["/admin/people/new", "Add a person"],
      ["/admin/people", "Manage profiles"],
      ["/admin/trainees", "Trainees"],
      ["/admin/offboarding", "Offboarding"],
    ],
  },
  {
    title: "Training",
    links: [["/admin/practice", "Reset one person's practice"]],
  },
  {
    title: "Scheduling",
    links: [
      ["/admin/shows", "RBC show days"],
      ["/admin/corrections", "Time corrections"],
    ],
  },
  {
    title: "Payroll",
    links: [["/admin/payroll", "Last week's pay"]],
  },
  {
    title: "Inventory",
    links: [
      ["/admin/checklist", "Order thresholds"],
      ["/inventory", "Stock"],
      ["/admin/photos", "Photo audit"],
    ],
  },
  {
    title: "Locations",
    links: [["/admin/access", "Site access"]],
  },
];

export function AdminHome() {
  const pending = useQuery({
    queryKey: ["corrections-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("time_corrections")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return (
    <Screen>
      <Title sub={pending.data ? `${pending.data} waiting` : "Nothing waiting"}>Admin</Title>
      <div className="grid gap-5">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{section.title}</h2>
            <div className="grid gap-3">
              {section.links.map(([to, label]) => (
                <Link key={to} to={to} className="flex min-h-12 items-center justify-between rounded-3xl bg-white px-4 text-lg font-semibold shadow-sm ring-1 ring-black/5">
                  <span>{label}</span>
                  {to === "/admin/corrections" && (pending.data ?? 0) > 0 ? (
                    <span className="rounded-full bg-red-700 px-2 text-sm text-white">{pending.data}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Screen>
  );
}

async function callAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-person", { body });
  if (error) {
    const context = error.context as { json?: () => Promise<{ error?: string }> } | undefined;
    if (context?.json) {
      const parsed = await context.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message);
  }
  const payload = data as { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return data;
}

export function AddPersonPage({ preview = false, previewSites = [] as SiteRow[] }: { preview?: boolean; previewSites?: SiteRow[] }) {
  const sites = useQuery({ queryKey: ["sites-admin"], enabled: !preview, queryFn: loadSites });
  const list = preview ? previewSites : (sites.data ?? []).filter((site) => !site.is_sandbox);
  const [fullName, setFullName] = useState("");
  const [goesBy, setGoesBy] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("tech");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSiteIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function save() {
    if (preview) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = (await callAdmin({
        action: "create",
        full_name: fullName,
        goes_by: goesBy,
        email,
        phone,
        role,
        site_ids: siteIds,
        temp_pin: pin,
      })) as { goes_by: string };
      setMessage(`${result.goes_by} can sign in with that temporary PIN. They will choose a new one.`);
      setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add them.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Tell them the temporary PIN in person. It is not emailed.">Add a person</Title>
      <Field label="Full name"><input className={inputClass} value={fullName} onChange={(event) => setFullName(event.target.value)} /></Field>
      <Field label="Goes by"><input className={inputClass} value={goesBy} onChange={(event) => setGoesBy(event.target.value)} /></Field>
      <Field label="Email"><input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Phone"><input className={inputClass} value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
      <p className="mb-2 text-sm font-medium text-stone-600">Role</p>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["tech", "trainee", "admin"] as Role[]).map((option) => (
          <Button key={option} tone={role === option ? "primary" : "quiet"} onClick={() => setRole(option)}>
            {option === "tech" ? "Tech" : option === "trainee" ? "Trainee" : "Admin"}
          </Button>
        ))}
      </div>
      <p className="mb-2 text-sm font-medium text-stone-600">Sites</p>
      <div className="mb-4 grid gap-2">
        {list.map((site) => (
          <Button key={site.id} tone={siteIds.includes(site.id) ? "primary" : "quiet"} onClick={() => toggle(site.id)}>
            {site.short_name}
          </Button>
        ))}
      </div>
      {role === "trainee" ? (
        <p className="mb-4 text-sm text-stone-600">Trainees only see the practice sites, even if you also pick live ones for later.</p>
      ) : null}
      <Field label="Temporary PIN (4 to 6 digits)">
        <input className={inputClass} inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      </Field>
      <Button className="w-full" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Add person"}</Button>
      {message ? <p className="mt-3 text-sm font-medium text-emerald-800">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

async function buildOffboarding(personId: string, personName: string): Promise<string> {
  const { data: assets, error: assetError } = await supabase
    .from("person_access_items")
    .select("kind, sites(name)")
    .eq("person_id", personId)
    .is("returned_at", null);
  if (assetError) {
    return "Person deactivated. Held keys could not be listed until the database update is applied.";
  }
  const { data: links } = await supabase.from("person_sites").select("site_id").eq("person_id", personId);
  const siteIds = (links ?? []).map((row) => row.site_id as string);
  const { data: codes } = siteIds.length
    ? await supabase.from("site_codes").select("label, sites(name)").in("site_id", siteIds)
    : { data: [] };
  const titles = offboardingTitles({
    personName,
    assets: (assets ?? []).map((row) => {
      const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
      return { siteName: site?.name ?? "a site", kind: row.kind as string };
    }),
    codeLabels: (codes ?? []).map((row) => {
      const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
      return { siteName: site?.name ?? "a site", label: row.label as string };
    }),
  });
  const { error } = await supabase.from("offboarding_tasks").insert(
    titles.map((title) => ({ person_id: personId, title, idempotency_key: crypto.randomUUID() })),
  );
  if (error) return "Person deactivated. The offboarding list could not be saved.";
  return "Person deactivated. Offboarding tasks were added. Codes are not written on those tasks.";
}

export function PeoplePage() {
  const people = useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const { data, error } = await supabase.from("people").select("id, full_name, goes_by, role, active, email").order("goes_by");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function act(action: string, personId: string, extra: Record<string, unknown> = {}) {
    setError("");
    setMessage("");
    try {
      await callAdmin({ action, person_id: personId, temp_pin: pin, ...extra });
      if (action === "deactivate") {
        const person = (people.data ?? []).find((row) => row.id === personId);
        const note = await buildOffboarding(personId, person?.goes_by ?? "This person");
        setMessage(note);
        return;
      }
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title>People</Title>
      <Field label="Temporary PIN for a reset">
        <input className={inputClass} inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      </Field>
      <div className="grid gap-3">
        {(people.data ?? []).map((person) => (
          <Card key={person.id}>
            <p className="text-lg font-semibold">{person.goes_by}</p>
            <p className="text-sm text-stone-600">{person.full_name} · {person.role} · {person.active ? "Active" : "Inactive"}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button tone="quiet" onClick={() => void act("reset_pin", person.id)}>Reset PIN</Button>
              <Button tone="quiet" onClick={() => void act("unlock", person.id)}>Unlock</Button>
              <Button tone="quiet" onClick={() => void act("deactivate", person.id)}>Deactivate</Button>
            </div>
          </Card>
        ))}
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

const CORRECTION_COLUMNS = "id, reason, requested_start, requested_end, status, was_paid, service_sessions(service_date, start_at, end_at, sites(short_name), people(goes_by))";

type CorrectionRow = {
  id: string;
  reason: string;
  requested_start: string | null;
  requested_end: string | null;
  status: string;
  was_paid: boolean;
  service_sessions: {
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    sites: { short_name: string } | { short_name: string }[] | null;
    people: { goes_by: string } | { goes_by: string }[] | null;
  } | {
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    sites: { short_name: string } | { short_name: string }[] | null;
    people: { goes_by: string } | { goes_by: string }[] | null;
  }[] | null;
};

function oneOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function CorrectionsPage() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const rows = useQuery({
    queryKey: ["corrections"],
    queryFn: async () => {
      const pending = await supabase
        .from("time_corrections")
        .select(CORRECTION_COLUMNS)
        .eq("status", "pending")
        .order("created_at");
      if (pending.error) throw new Error(pending.error.message);
      const decided = await supabase
        .from("time_corrections")
        .select(CORRECTION_COLUMNS)
        .neq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);
      if (decided.error) throw new Error(decided.error.message);
      return {
        pending: (pending.data ?? []) as CorrectionRow[],
        decided: (decided.data ?? []) as CorrectionRow[],
      };
    },
  });

  async function decide(id: string, approve: boolean, wasPaid: boolean) {
    setError("");
    const { error: updateError } = await supabase.from("time_corrections").update({ was_paid: wasPaid }).eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    const { error: rpcError } = await supabase.rpc("decide_correction", { p_id: id, p_approve: approve, p_note: note });
    if (rpcError) setError(rpcError.message);
    else {
      await queryClient.invalidateQueries({ queryKey: ["corrections"] });
      await queryClient.invalidateQueries({ queryKey: ["corrections-count"] });
    }
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Pay adjustments are Phase 2. Mark it if the time was already paid.">Corrections</Title>
      <Field label="Note for the decision">
        <textarea className={`${inputClass} min-h-24 py-3`} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Waiting</h2>
      <div className="grid gap-3">
        {(rows.data?.pending ?? []).map((row) => (
          <CorrectionCard key={row.id} row={row} onDecide={decide} />
        ))}
        {(rows.data?.pending ?? []).length === 0 ? <p className="text-stone-600">Nothing waiting.</p> : null}
      </div>
      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-stone-500">Decided</h2>
      <div className="grid gap-3">
        {(rows.data?.decided ?? []).map((row) => (
          <CorrectionCard key={row.id} row={row} />
        ))}
        {(rows.data?.decided ?? []).length === 0 ? <p className="text-stone-600">No decisions yet.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

function CorrectionCard({
  row,
  onDecide,
}: {
  row: CorrectionRow;
  onDecide?: (id: string, approve: boolean, wasPaid: boolean) => Promise<void>;
}) {
  const [paid, setPaid] = useState(row.was_paid);
  const session = oneOf(row.service_sessions);
  const site = oneOf(session?.sites ?? null);
  const person = oneOf(session?.people ?? null);
  const who = [person?.goes_by, site?.short_name].filter(Boolean).join(" · ");
  if (!session?.service_date) {
    return (
      <Card>
        <p className="font-semibold">{who || "Visit"}</p>
        <p className="text-sm text-stone-600">The visit times could not be loaded.</p>
        <p className="mt-2 text-sm">{row.reason}</p>
      </Card>
    );
  }
  const glance = correctionGlance({
    serviceDate: session.service_date,
    startAt: session.start_at,
    endAt: session.end_at,
    requestedStart: row.requested_start,
    requestedEnd: row.requested_end,
  });
  return (
    <Card>
      <CorrectionGlanceView glance={glance} who={who || "Visit"} reason={row.reason} status={row.status} />
      {onDecide ? (
        <>
          <label className="mt-3 flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
            This time was already paid
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button onClick={() => void onDecide(row.id, true, paid)}>Approve</Button>
            <Button tone="quiet" onClick={() => void onDecide(row.id, false, paid)}>Reject</Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}

export function TraineesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const people = useQuery({
    queryKey: ["trainees"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by, role").eq("role", "trainee").eq("active", true);
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("models").select("id, code, name");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const progress = useQuery({
    queryKey: ["all-training"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("training_progress").select("person_id, model_id, status, reviewed_services");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });

  async function setStatus(personId: string, modelId: string, status: string, reviewed: number) {
    const { error: rpcError } = await supabase.rpc("set_training_status", {
      p_person: personId,
      p_model: modelId,
      p_status: status,
      p_reviewed: reviewed,
    });
    if (rpcError) setError(rpcError.message);
    else await queryClient.invalidateQueries({ queryKey: ["all-training"] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="In training, quiz passed, solo after 3 reviewed services, then signed off.">Trainees</Title>
      <div className="grid gap-3">
        {(people.data ?? []).map((person) => (
          <Card key={person.id}>
            <p className="text-lg font-semibold">{person.goes_by}</p>
            {(models.data ?? []).map((model) => {
              const row = (progress.data ?? []).find((item) => item.person_id === person.id && item.model_id === model.id);
              const reviewed = row?.reviewed_services ?? 0;
              return (
                <div key={model.id} className="mt-3">
                  <p className="text-sm font-medium">{model.name}: {row?.status ?? "in_training"} · {reviewed} reviewed</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button tone="quiet" onClick={() => void setStatus(person.id, model.id, "solo", reviewed)}>Solo</Button>
                    <Button tone="quiet" onClick={() => void setStatus(person.id, model.id, "signed_off", reviewed)}>Signed off</Button>
                  </div>
                </div>
              );
            })}
          </Card>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function ShowsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const rbc = (sites.data ?? []).find((site) => site.cadence === "show_days" && site.is_sandbox === (profile?.mode === "practice"));

  async function save() {
    if (!rbc) {
      setError("No RBC site in this mode.");
      return;
    }
    const parsed = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/.exec(line);
        if (!match) return null;
        return { site_id: rbc.id, date: match[1], show_start_time: match[2], status: "scheduled", idempotency_key: crypto.randomUUID() };
      });
    const rows = parsed.filter((row): row is NonNullable<(typeof parsed)[number]> => row != null);
    if (rows.length !== parsed.length || rows.length === 0) {
      setError("Use one show per line: YYYY-MM-DD HH:MM");
      return;
    }
    const { error: upsertError } = await supabase.from("show_days").upsert(rows, { onConflict: "site_id,date" });
    if (upsertError) setError(upsertError.message);
    else {
      setMessage(`Saved ${rows.length} show days.`);
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["shows"] });
    }
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="The real 2027 list is not in yet. Practice show days reset with practice data.">RBC show days</Title>
      <p className="mb-3 text-sm text-stone-600">One per line, like 2027-05-20 18:00. Saving {rbc?.name ?? "…"}.</p>
      <textarea className={`${inputClass} min-h-40 py-3`} value={text} onChange={(event) => setText(event.target.value)} placeholder="YYYY-MM-DD HH:MM" />
      <Button className="mt-3" onClick={() => void save()}>Save show days</Button>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function ChecklistPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const items = useQuery({
    queryKey: ["editor-items"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("checklist_items")
        .select("id, title, details, cadence_type, cadence_days, required, status, key, checklist_sections(checklist_templates(models(code, name)))")
        .order("title");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const [itemId, setItemId] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: ["item-settings", itemId],
    enabled: Boolean(itemId),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("site_item_settings")
        .select("site_id, threshold_value, threshold_unit")
        .eq("item_id", itemId!);
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const item = (items.data ?? []).find((row) => row.id === itemId);

  async function saveItem(patch: Record<string, unknown>) {
    if (!item) return;
    const { error: updateError } = await supabase.from("checklist_items").update(patch).eq("id", item.id);
    if (updateError) setError(updateError.message);
    else await queryClient.invalidateQueries({ queryKey: ["editor-items"] });
  }

  async function saveThreshold(siteId: string, value: string) {
    if (!item) return;
    const numeric = value.trim() === "" ? null : Number(value);
    const { error: upsertError } = await supabase.from("site_item_settings").upsert(
      { site_id: siteId, item_id: item.id, threshold_value: numeric, enabled: true, idempotency_key: crypto.randomUUID() },
      { onConflict: "site_id,item_id" },
    );
    if (upsertError) setError(upsertError.message);
    else await queryClient.invalidateQueries({ queryKey: ["item-settings", item.id] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="The sentence under each site is what techs see. A blank number with no instruction says Check. Fill if low.">Order thresholds</Title>
      {item ? (
        <Card>
          <Field label="Title"><input className={inputClass} defaultValue={item.title} onBlur={(event) => void saveItem({ title: event.target.value })} /></Field>
          <Field label="Details"><textarea className={`${inputClass} min-h-28 py-3`} defaultValue={item.details ?? ""} onBlur={(event) => void saveItem({ details: event.target.value })} /></Field>
          <Field label="Cadence">
            <select className={inputClass} defaultValue={item.cadence_type} onChange={(event) => void saveItem({ cadence_type: event.target.value })}>
              {["every_visit", "every_n_days", "weekly", "biweekly", "monthly", "below_threshold", "check_decide"].map((cadence) => (
                <option key={cadence}>{cadence}</option>
              ))}
            </select>
          </Field>
          <label className="mb-3 flex min-h-12 items-center gap-2">
            <input type="checkbox" defaultChecked={item.required} onChange={(event) => void saveItem({ required: event.target.checked })} />
            Required
          </label>
          <Field label="Status">
            <select className={inputClass} defaultValue={item.status} onChange={(event) => void saveItem({ status: event.target.value })}>
              <option value="active">active</option>
              <option value="pending_validation">pending_validation</option>
            </select>
          </Field>
          {item.cadence_type === "below_threshold" ? (
            <div className="grid gap-3">
              <p className="text-sm font-medium">Per-site fill level. Saving a number does not change the stored instruction.</p>
              {(sites.data ?? []).map((site) => {
                const saved = (settings.data ?? []).find((row) => row.site_id === site.id);
                const value = saved?.threshold_value ?? null;
                const unit = saved?.threshold_unit ?? null;
                return (
                  <label key={site.id} className="block text-sm">
                    {site.short_name}
                    <input
                      key={`${item.id}-${site.id}-${value ?? "blank"}`}
                      className={`${inputClass} mt-1`}
                      inputMode="decimal"
                      placeholder="Blank"
                      defaultValue={value ?? ""}
                      onBlur={(event) => void saveThreshold(site.id, event.target.value)}
                    />
                    <span className="mt-1 block text-stone-600">{thresholdDetail(value, unit)}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
          <Button className="mt-3" tone="quiet" onClick={() => setItemId(null)}>Back to the list</Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {groupChecklist(items.data ?? [], sites.data ?? []).map((group) => (
            <section key={group.heading}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{group.heading}</h2>
              <div className="grid gap-2">
                {group.items.map((row) => (
                  <button key={row.id} type="button" className="min-h-12 rounded-2xl bg-white px-4 text-left font-medium ring-1 ring-black/5" onClick={() => setItemId(row.id)}>
                    {row.title}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

type EditorItem = {
  id: string;
  title: string;
  key: string;
  checklist_sections:
    | { checklist_templates: { models: { code: string; name: string } | { code: string; name: string }[] | null } | { models: { code: string; name: string } | { code: string; name: string }[] | null }[] | null }
    | { checklist_templates: { models: { code: string; name: string } | { code: string; name: string }[] | null } | { models: { code: string; name: string } | { code: string; name: string }[] | null }[] | null }[]
    | null;
};

function modelOf(row: EditorItem): { code: string; name: string } | null {
  const section = Array.isArray(row.checklist_sections) ? row.checklist_sections[0] : row.checklist_sections;
  const template = section && (Array.isArray(section.checklist_templates) ? section.checklist_templates[0] : section.checklist_templates);
  const model = template && (Array.isArray(template.models) ? template.models[0] : template.models);
  return model ?? null;
}

function groupChecklist(items: EditorItem[], sites: SiteRow[]) {
  const groups = new Map<string, { heading: string; items: EditorItem[] }>();
  for (const item of items) {
    const model = modelOf(item);
    const names = sites
      .filter((site) => !site.is_sandbox && site.models?.code === model?.code)
      .map((site) => site.short_name);
    const heading = model ? `${model.name}${names.length ? ` · ${names.join(", ")}` : ""}` : "Checklist";
    const group = groups.get(heading) ?? { heading, items: [] };
    group.items.push(item);
    groups.set(heading, group);
  }
  return [...groups.values()];
}

export function PracticeResetPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by, role").order("goes_by");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const person = (people.data ?? []).find((row) => row.id === personId);

  async function reset() {
    if (!personId || !person) return;
    setBusy(true);
    setError("");
    setMessage("");
    const { error: rpcError } = await supabase.rpc("reset_person_sandbox", { p_person: personId });
    setBusy(false);
    if (rpcError) {
      const missing = rpcError.code === "PGRST202" || /reset_person_sandbox/i.test(rpcError.message);
      setError(missing ? "Per-person practice reset is not turned on yet. Nothing was deleted." : rpcError.message);
      return;
    }
    setMessage(`Deleted only ${person.goes_by}'s practice visits and answers. Live visits, other people, and shared practice fill dates were not changed.`);
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="One person at a time. This does not wipe everyone's practice data, and it does not touch live visits.">
        Reset one person's practice
      </Title>
      <div className="grid gap-2">
        {(people.data ?? []).map((row) => (
          <Button key={row.id} tone={personId === row.id ? "primary" : "quiet"} onClick={() => setPersonId(row.id)}>
            {row.goes_by} · {row.role}
          </Button>
        ))}
      </div>
      <Button className="mt-4 w-full" disabled={!personId || busy} onClick={() => void reset()}>
        {busy ? "Resetting" : person ? `Reset ${person.goes_by}'s practice visits` : "Choose a person"}
      </Button>
      {message ? <p className="mt-3 text-sm font-medium">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function AccessPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const people = useQuery({
    queryKey: ["people"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by").eq("active", true).order("goes_by");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const codes = useQuery({
    queryKey: ["site-codes"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("site_codes").select("id, site_id, label, code, sites(short_name)");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const assets = useQuery({
    queryKey: ["access-items"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("person_access_items")
        .select("id, person_id, site_id, kind, note, returned_at, people(goes_by), sites(short_name)");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const [siteId, setSiteId] = useState("");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [holderId, setHolderId] = useState("");
  const [assetSite, setAssetSite] = useState("");
  const [kind, setKind] = useState("key_card");
  const [note, setNote] = useState("");
  const liveSites = (sites.data ?? []).filter((site) => !site.is_sandbox);

  async function addCode() {
    if (!siteId || !label.trim() || !code.trim()) {
      setError("Choose a site, a label, and the code.");
      return;
    }
    setError("");
    const { error: insertError } = await supabase.from("site_codes").insert({
      site_id: siteId,
      label: label.trim(),
      code: code.trim(),
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCode("");
    setLabel("");
    setMessage("Saved. This code stays in the database only.");
    await queryClient.invalidateQueries({ queryKey: ["site-codes"] });
  }

  async function addAsset() {
    if (!holderId || !assetSite) {
      setError("Choose a person and a site.");
      return;
    }
    setError("");
    const { error: insertError } = await supabase.from("person_access_items").insert({
      person_id: holderId,
      site_id: assetSite,
      kind,
      note: note.trim() || null,
    });
    if (insertError) {
      const missing = insertError.code === "PGRST205" || /person_access_items/i.test(insertError.message);
      setError(missing ? "Held keys are not turned on until the database update is applied." : insertError.message);
      return;
    }
    setNote("");
    setMessage("Recorded. The printable UofT pass is still printed outside this app.");
    await queryClient.invalidateQueries({ queryKey: ["access-items"] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Codes are stored here for signed-in staff at that site. They are not part of the app install.">Site access</Title>
      <p className="mb-4 text-sm text-stone-600">
        Printable UofT parking passes are not an upload yet. Record that someone holds a paper pass, and print the pass outside the app.
      </p>
      <Card className="mb-4">
        <h2 className="font-semibold">Shared site code</h2>
        <Field label="Site">
          <select className={inputClass} value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">Choose</option>
            {liveSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
          </select>
        </Field>
        <Field label="Label"><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Fridge" /></Field>
        <Field label="Code"><input className={inputClass} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
        <Button onClick={() => void addCode()}>Save code</Button>
        <div className="mt-3 grid gap-2">
          {(codes.data ?? []).map((row) => {
            const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
            return <p key={row.id} className="text-sm">{site?.short_name} · {row.label}</p>;
          })}
          {(codes.data ?? []).length === 0 ? <p className="text-sm text-stone-600">No codes saved yet.</p> : null}
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">What a person holds</h2>
        <Field label="Person">
          <select className={inputClass} value={holderId} onChange={(event) => setHolderId(event.target.value)}>
            <option value="">Choose</option>
            {(people.data ?? []).map((person) => <option key={person.id} value={person.id}>{person.goes_by}</option>)}
          </select>
        </Field>
        <Field label="Site">
          <select className={inputClass} value={assetSite} onChange={(event) => setAssetSite(event.target.value)}>
            <option value="">Choose</option>
            {liveSites.map((site) => <option key={site.id} value={site.id}>{site.short_name}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className={inputClass} value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="key_card">Key card</option>
            <option value="paper_pass">Paper pass</option>
            <option value="machine_key">Machine key</option>
          </select>
        </Field>
        <Field label="Note"><input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <Button onClick={() => void addAsset()}>Save item</Button>
        <div className="mt-3 grid gap-2">
          {(assets.data ?? []).map((row) => {
            const person = Array.isArray(row.people) ? row.people[0] : row.people;
            const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
            return (
              <p key={row.id} className="text-sm">
                {person?.goes_by} · {site?.short_name} · {row.kind}{row.returned_at ? " · returned" : ""}
              </p>
            );
          })}
        </div>
      </Card>
      {message ? <p className="mt-3 text-sm font-medium">{message}</p> : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function OffboardingPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const { profile } = useAuth();
  const tasks = useQuery({
    queryKey: ["offboarding"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("offboarding_tasks").select("id, title, done, person_id").order("created_at");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  async function toggle(id: string, done: boolean) {
    const { error: updateError } = await supabase
      .from("offboarding_tasks")
      .update({ done, done_at: done ? new Date().toISOString() : null, done_by: done ? profile?.id : null })
      .eq("id", id);
    if (updateError) setError(updateError.message);
    else await queryClient.invalidateQueries({ queryKey: ["offboarding"] });
  }
  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Reminders only. A code value is never written on a task.">Offboarding</Title>
      <div className="grid gap-3">
        {(tasks.data ?? []).map((task) => (
          <Card key={task.id}>
            <p className={task.done ? "text-stone-500 line-through" : ""}>{task.title}</p>
            <Button className="mt-3" tone="quiet" onClick={() => void toggle(task.id, !task.done)}>
              {task.done ? "Mark not done" : "Mark done"}
            </Button>
          </Card>
        ))}
        {(tasks.data ?? []).length === 0 ? <p className="text-stone-600">No offboarding tasks yet.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
