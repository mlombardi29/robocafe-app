import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { supabase } from "../lib/supabase";
import type { Role, SiteRow } from "../lib/types";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

const links = [
  ["/admin/people/new", "Add a person"],
  ["/admin/people", "People"],
  ["/admin/corrections", "Time corrections"],
  ["/admin/trainees", "Trainees"],
  ["/admin/shows", "RBC show days"],
  ["/admin/checklist", "Checklist items"],
  ["/admin/practice", "Reset practice data"],
  ["/admin/offboarding", "Offboarding"],
];

export function AdminHome() {
  return (
    <Screen>
      <Title>Admin</Title>
      <div className="grid gap-3">
        {links.map(([to, label]) => (
          <Link key={to} to={to} className="flex min-h-12 items-center rounded-3xl bg-white px-4 text-lg font-semibold shadow-sm ring-1 ring-black/5">
            {label}
          </Link>
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

export function CorrectionsPage() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const rows = useQuery({
    queryKey: ["corrections"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("time_corrections")
        .select("id, reason, requested_start, requested_end, status, was_paid, session_id")
        .eq("status", "pending")
        .order("created_at");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
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
    else await queryClient.invalidateQueries({ queryKey: ["corrections"] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Pay adjustments are Phase 2. Mark it if the time was already paid.">Corrections</Title>
      <Field label="Note for the decision">
        <textarea className={`${inputClass} min-h-24 py-3`} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="grid gap-3">
        {(rows.data ?? []).map((row) => (
          <CorrectionCard key={row.id} row={row} onDecide={decide} />
        ))}
        {(rows.data ?? []).length === 0 ? <p className="text-stone-600">Nothing waiting.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

function CorrectionCard({
  row,
  onDecide,
}: {
  row: { id: string; reason: string; requested_start: string | null; requested_end: string | null; was_paid: boolean };
  onDecide: (id: string, approve: boolean, wasPaid: boolean) => Promise<void>;
}) {
  const [paid, setPaid] = useState(row.was_paid);
  return (
    <Card>
      <p className="font-semibold">{row.reason}</p>
      <p className="text-sm text-stone-600">{row.requested_start ?? "Same start"} → {row.requested_end ?? "Same end"}</p>
      <label className="mt-3 flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />
        This time was already paid
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button onClick={() => void onDecide(row.id, true, paid)}>Approve</Button>
        <Button tone="quiet" onClick={() => void onDecide(row.id, false, paid)}>Reject</Button>
      </div>
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
        .select("id, title, details, cadence_type, cadence_days, required, status, key")
        .order("title");
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });
  const sites = useQuery({ queryKey: ["sites-admin"], queryFn: loadSites });
  const [itemId, setItemId] = useState<string | null>(null);
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
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Threshold numbers are TODO until you set them. Blank means “Check. Fill if low.”">Checklist</Title>
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
            <div className="grid gap-2">
              <p className="text-sm font-medium">Per-site threshold. TODO: not set yet.</p>
              {(sites.data ?? []).map((site) => (
                <label key={site.id} className="block text-sm">
                  {site.short_name}
                  <input className={`${inputClass} mt-1`} inputMode="decimal" placeholder="Blank" onBlur={(event) => void saveThreshold(site.id, event.target.value)} />
                </label>
              ))}
            </div>
          ) : null}
          <Button className="mt-3" tone="quiet" onClick={() => setItemId(null)}>Back to the list</Button>
        </Card>
      ) : (
        <div className="grid gap-2">
          {(items.data ?? []).map((row) => (
            <button key={row.id} type="button" className="min-h-12 rounded-2xl bg-white px-4 text-left font-medium ring-1 ring-black/5" onClick={() => setItemId(row.id)}>
              {row.title}
            </button>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function PracticeResetPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("reset_sandbox");
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else setMessage("Practice visits, practice stock dates, and practice show days were reset.");
  }
  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="This deletes practice visits only. Live rows stay.">Reset practice data</Title>
      <Button disabled={busy} onClick={() => void reset()}>{busy ? "Resetting" : "Reset practice data"}</Button>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
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
      <Title sub="Codes are not stored in the app yet. These are reminders to rotate them.">Offboarding</Title>
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
