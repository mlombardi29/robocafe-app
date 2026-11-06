import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { formatTorontoTime, formatWhen, instantOnTorontoDay } from "../lib/dates";
import { durationLabel, durationMinutes } from "../lib/timeRange";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, inputClass } from "../ui";
import type { Snapshot } from "../lib/types";

type Named = { short_name?: string; goes_by?: string } | { short_name?: string; goes_by?: string }[] | null;

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

type ListRow = {
  id: string;
  site_id: string;
  person_id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  sites: Named;
  people: Named;
};

export function HistoryPage() {
  const query = useQuery({
    queryKey: ["history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_sessions")
        .select("id, site_id, person_id, service_date, start_at, end_at, status, sites(short_name), people(goes_by)")
        .eq("status", "completed")
        .order("service_date", { ascending: false })
        .limit(80);
      if (error) throw new Error(error.message);
      return (data ?? []) as ListRow[];
    },
  });
  const groups = new Map<string, ListRow[]>();
  for (const row of query.data ?? []) {
    const site = one(row.sites);
    const name = site?.short_name ?? "Visit";
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }

  return (
    <Screen>
      <Link to="/" className="text-sm font-semibold text-[var(--accent)]">Home</Link>
      <h1 className="mt-2 text-3xl font-semibold">Past visits</h1>
      <p className="text-stone-600">Open a visit to see the submitted steps, notes, and outcomes. Admins can open any person’s visit.</p>
      <div className="mt-4 grid gap-4">
        {[...groups.entries()].map(([name, rows]) => (
          <section key={name}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{name}</h2>
            <div className="grid gap-2">
              {rows.map((row) => (
                <Link key={row.id} to={`/history/${row.id}`} className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
                  <p className="font-semibold">{one(row.people)?.goes_by ? `${one(row.people)?.goes_by} · ` : ""}{row.service_date}</p>
                  <p className="text-sm text-stone-600">
                    {formatTorontoTime(row.start_at)} to {formatTorontoTime(row.end_at)} · {durationLabel(durationMinutes(row.start_at, row.end_at))}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}
        {query.isLoading ? <p className="text-stone-600">Loading…</p> : null}
        {query.error ? <ErrorText>{query.error instanceof Error ? query.error.message : "Could not load visits."}</ErrorText> : null}
        {!query.isLoading && (query.data ?? []).length === 0 ? <p className="text-stone-600">No completed visits yet.</p> : null}
      </div>
    </Screen>
  );
}

export function HistoryVisitPage() {
  const { sessionId = "" } = useParams();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const query = useQuery({
    queryKey: ["history-visit", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const { data: session, error } = await supabase
        .from("service_sessions")
        .select("id, person_id, service_date, start_at, end_at, status, checklist_snapshot, sites(short_name), people(goes_by)")
        .eq("id", sessionId)
        .maybeSingle();
      if (error || !session) throw new Error(error?.message ?? "Visit not found.");
      const { data: completions, error: completionError } = await supabase
        .from("service_item_completions")
        .select("item_id, state, note")
        .eq("session_id", sessionId);
      if (completionError) throw new Error(completionError.message);
      return { session, completions: completions ?? [] };
    },
  });

  if (query.isLoading) {
    return <Screen><p className="text-stone-600">Loading…</p></Screen>;
  }
  if (query.error || !query.data) {
    return (
      <Screen>
        <Link to="/history" className="text-sm font-semibold text-[var(--accent)]">Past visits</Link>
        <ErrorText>{query.error instanceof Error ? query.error.message : "Visit not found."}</ErrorText>
      </Screen>
    );
  }

  const session = query.data.session as {
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    checklist_snapshot: Snapshot | null;
    sites: Named;
    people: Named;
  };
  const snapshot = session.checklist_snapshot;
  const byItem = new Map(query.data.completions.map((row) => [row.item_id, row]));
  const site = one(session.sites);
  const person = one(session.people);

  async function sendCorrection() {
    if (!profile || reason.trim().length < 3) {
      setError("Say what should change.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("time_corrections").insert({
      session_id: sessionId,
      requested_by: profile.id,
      reason: reason.trim(),
      requested_start: date && start ? instantOnTorontoDay(date, start) : null,
      requested_end: date && end ? instantOnTorontoDay(date, end) : null,
      idempotency_key: crypto.randomUUID(),
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setSent(true);
    setReason("");
    await queryClient.invalidateQueries({ queryKey: ["my-time"] });
  }
  const steps = (snapshot?.sections ?? []).flatMap((section) =>
    section.items.map((item) => ({
      title: item.title,
      state: byItem.get(item.id)?.state ?? "Not marked",
      note: byItem.get(item.id)?.note ?? "",
    })),
  );

  return (
    <Screen>
      <Link to="/history" className="text-sm font-semibold text-[var(--accent)]">Past visits</Link>
      <h1 className="mt-2 text-3xl font-semibold">View servicing</h1>
      <p className="text-stone-600">
        {person?.goes_by ? `${person.goes_by} · ` : ""}{site?.short_name ?? "Visit"} · {session.service_date}
      </p>
      <p className="text-sm text-stone-600">
        {formatWhen(session.start_at)} to {formatWhen(session.end_at)}
      </p>
      <div className="mt-4 grid gap-2">
        {steps.map((step) => (
          <Card key={step.title}>
            <p className="font-semibold">{step.title}</p>
            <p className="text-sm text-stone-600">{step.state}</p>
            {step.note ? <p className="mt-1 text-sm text-stone-700">{step.note}</p> : null}
          </Card>
        ))}
        {steps.length === 0 ? <p className="text-stone-600">No checklist was saved on this visit.</p> : null}
      </div>
      <Card className="mt-4">
        <h2 className="text-lg font-semibold">Request a correction</h2>
        {sent ? <p className="mt-2 text-sm font-medium text-emerald-800">Request sent.</p> : null}
        <Field label="What should change?">
          <textarea className={`${inputClass} min-h-24 py-3`} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="Date">
          <input className={inputClass} type="date" value={date || session.service_date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Requested start">
          <input className={inputClass} type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="Requested end">
          <input className={inputClass} type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
        <Button disabled={busy} onClick={() => void sendCorrection()}>{busy ? "Sending" : "Send request"}</Button>
        <ErrorText>{error}</ErrorText>
      </Card>
    </Screen>
  );
}
