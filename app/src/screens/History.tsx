import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { formatTorontoTime, formatWhen } from "../lib/dates";
import { durationLabel, durationMinutes } from "../lib/timeRange";
import { supabase } from "../lib/supabase";
import { Card, ErrorText, Screen } from "../ui";
import type { Snapshot } from "../lib/types";

type ListRow = {
  id: string;
  site_id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  status: string;
  sites: { short_name: string } | { short_name: string }[] | null;
};

export function HistoryPage() {
  const query = useQuery({
    queryKey: ["history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_sessions")
        .select("id, site_id, service_date, start_at, end_at, status, sites(short_name)")
        .eq("status", "completed")
        .order("service_date", { ascending: false })
        .limit(80);
      if (error) throw new Error(error.message);
      return (data ?? []) as ListRow[];
    },
  });
  const groups = new Map<string, ListRow[]>();
  for (const row of query.data ?? []) {
    const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
    const name = site?.short_name ?? "Visit";
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }

  return (
    <Screen>
      <Link to="/" className="text-sm font-semibold text-[var(--accent)]">Home</Link>
      <h1 className="mt-2 text-3xl font-semibold">Past visits</h1>
      <p className="text-stone-600">Completed visits for the sites you can see. Open one to read the ticks.</p>
      <div className="mt-4 grid gap-4">
        {[...groups.entries()].map(([name, rows]) => (
          <section key={name}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{name}</h2>
            <div className="grid gap-2">
              {rows.map((row) => (
                <Link key={row.id} to={`/history/${row.id}`} className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
                  <p className="font-semibold">{row.service_date}</p>
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
  const query = useQuery({
    queryKey: ["history-visit", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const { data: session, error } = await supabase
        .from("service_sessions")
        .select("id, service_date, start_at, end_at, status, checklist_snapshot, sites(short_name)")
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

  const snapshot = query.data.session.checklist_snapshot as Snapshot | null;
  const byItem = new Map(query.data.completions.map((row) => [row.item_id, row]));
  const site = Array.isArray(query.data.session.sites) ? query.data.session.sites[0] : query.data.session.sites;
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
      <h1 className="mt-2 text-3xl font-semibold">{site?.short_name ?? "Visit"}</h1>
      <p className="text-stone-600">
        {query.data.session.service_date} · {formatWhen(query.data.session.start_at)} to {formatWhen(query.data.session.end_at)}
      </p>
      <p className="mt-1 text-sm font-medium text-stone-500">Read only.</p>
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
    </Screen>
  );
}
