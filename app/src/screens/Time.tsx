import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { formatTorontoTime, instantOnTorontoDay, torontoNow } from "../lib/dates";
import { correctionGlance } from "../lib/correctionGlance";
import { durationLabel, durationMinutes, inRange, rangeBounds, type RangeKey } from "../lib/timeRange";
import { supabase } from "../lib/supabase";
import { CorrectionGlanceView } from "./CorrectionGlance";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "this-week", label: "This week" },
  { key: "this-month", label: "This month" },
  { key: "this-year", label: "This year" },
  { key: "all-time", label: "All time" },
];

type Session = {
  id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  submitted_at: string | null;
  status: string;
  site_id: string;
  sites: { short_name: string } | { short_name: string }[] | null;
};

export function TimePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const today = torontoNow().today;
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<RangeKey>("this-month");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [siteId, setSiteId] = useState("all");

  const requests = useQuery({
    queryKey: ["my-corrections", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("time_corrections")
        .select("id, reason, status, requested_start, requested_end, service_sessions(service_date, start_at, end_at, sites(short_name))")
        .eq("requested_by", profile!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
  });

  const query = useQuery({
    queryKey: ["my-time", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("service_sessions")
        .select("id, site_id, service_date, start_at, end_at, submitted_at, status, sites(short_name)")
        .eq("person_id", profile!.id)
        .eq("status", "completed")
        .order("service_date", { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Session[];
    },
  });

  const bounds = rangeBounds(range, today, customFrom, customTo);
  const sites = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of query.data ?? []) {
      const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
      map.set(row.site_id, site?.short_name ?? "Visit");
    }
    return [...map.entries()];
  }, [query.data]);

  const visible = (query.data ?? []).filter((row) => {
    if (siteId !== "all" && row.site_id !== siteId) return false;
    return inRange(row.service_date, bounds.from, bounds.to);
  });

  const years = useMemo(() => {
    const yearMap = new Map<string, Map<string, Session[]>>();
    for (const row of visible) {
      const year = row.service_date.slice(0, 4);
      const month = row.service_date.slice(0, 7);
      const months = yearMap.get(year) ?? new Map<string, Session[]>();
      months.set(month, [...(months.get(month) ?? []), row]);
      yearMap.set(year, months);
    }
    return [...yearMap.entries()].map(([year, months]) => [year, [...months.entries()]] as const);
  }, [visible]);

  async function send() {
    if (!openId || reason.trim().length < 3) {
      setError("Say what should change.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("time_corrections").insert({
      session_id: openId,
      requested_by: profile!.id,
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
    setOpenId(null);
    setReason("");
    await queryClient.invalidateQueries({ queryKey: ["my-time"] });
    await queryClient.invalidateQueries({ queryKey: ["my-corrections"] });
  }

  return (
    <Screen>
      <Title sub="Submitted times stay locked. Ask an admin to change one.">My time</Title>
      {(requests.data ?? []).length > 0 ? (
        <div className="mb-5 grid gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Your requests</h2>
          {(requests.data ?? []).map((row) => {
            const session = Array.isArray(row.service_sessions) ? row.service_sessions[0] : row.service_sessions;
            const site = session ? (Array.isArray(session.sites) ? session.sites[0] : session.sites) : null;
            if (!session?.service_date) return null;
            const glance = correctionGlance({
              serviceDate: session.service_date,
              startAt: session.start_at,
              endAt: session.end_at,
              requestedStart: row.requested_start,
              requestedEnd: row.requested_end,
            });
            return (
              <Card key={row.id}>
                <CorrectionGlanceView glance={glance} who={site?.short_name} reason={row.reason} status={row.status} />
              </Card>
            );
          })}
        </div>
      ) : null}
      <label className="mb-3 block text-sm font-medium text-stone-600">
        Location
        <select className={`${inputClass} mt-1`} value={siteId} onChange={(event) => setSiteId(event.target.value)}>
          <option value="all">All locations</option>
          {sites.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </label>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`min-h-11 shrink-0 rounded-2xl px-3 text-base font-semibold ${range === item.key ? "bg-[var(--accent)] text-white" : "bg-white ring-1 ring-stone-200"}`}
            onClick={() => setRange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {range === "custom" ? (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <input className={inputClass} type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
          <input className={inputClass} type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
        </div>
      ) : null}
      <div className="grid gap-4">
        {years.map(([year, months]) => {
          const multiYear = years.length > 1;
          const yearOpen = !multiYear || year === today.slice(0, 4) || openGroups[year];
          const yearCount = months.reduce((sum, [, rows]) => sum + rows.length, 0);
          return (
            <section key={year}>
              {multiYear ? (
                <button
                  type="button"
                  className="mb-2 min-h-11 text-left text-lg font-semibold"
                  onClick={() => setOpenGroups((current) => ({ ...current, [year]: !yearOpen }))}
                >
                  {year} · {yearCount} visit{yearCount === 1 ? "" : "s"}{yearOpen ? " · Hide" : " · Show"}
                </button>
              ) : null}
              {yearOpen ? months.map(([month, rows]) => {
          const total = rows.reduce((sum, row) => sum + (durationMinutes(row.start_at, row.end_at) ?? 0), 0);
          const collapse = visible.length > 10;
          const currentMonth = today.slice(0, 7);
          const open = !collapse || month === currentMonth || openGroups[month];
          return (
            <section key={month}>
              <button
                type="button"
                className="mb-2 min-h-11 text-left text-sm font-bold uppercase tracking-wide text-stone-500"
                onClick={() => setOpenGroups((current) => ({ ...current, [month]: !open }))}
              >
                {month} · {rows.length} visit{rows.length === 1 ? "" : "s"} · {durationLabel(total)}
                {collapse ? (open ? " · Hide" : " · Show") : ""}
              </button>
              {open ? <div className="grid gap-3">
                {rows.map((row) => {
                  const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
                  const long = row.start_at && row.end_at && new Date(row.end_at).getTime() - new Date(row.start_at).getTime() > SIX_HOURS;
                  return (
                    <Card key={row.id}>
                      <p className="font-semibold">{site?.short_name ?? "Visit"} · {row.service_date}</p>
                      <p className="text-sm text-stone-600">
                        {formatTorontoTime(row.start_at)} to {formatTorontoTime(row.end_at)} · {durationLabel(durationMinutes(row.start_at, row.end_at))}
                      </p>
                      {long ? <p className="mt-1 text-sm font-medium text-amber-800">Over 6 hours. Check AM/PM.</p> : null}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Link to={`/history/${row.id}`} className="flex min-h-12 items-center justify-center rounded-2xl bg-white px-3 text-center text-base font-semibold text-stone-800 ring-1 ring-stone-200">
                          View servicing
                        </Link>
                        <Button tone="quiet" onClick={() => { setOpenId(row.id); setDate(row.service_date); }}>
                          Request a correction
                        </Button>
                      </div>
                      {openId === row.id ? (
                        <div className="mt-3">
                          <Field label="What should change?">
                            <textarea className={`${inputClass} min-h-24 py-3`} value={reason} onChange={(event) => setReason(event.target.value)} />
                          </Field>
                          <Field label="Date">
                            <input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                          </Field>
                          <Field label="Requested start">
                            <input className={inputClass} type="time" value={start} onChange={(event) => setStart(event.target.value)} />
                          </Field>
                          <Field label="Requested end">
                            <input className={inputClass} type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
                          </Field>
                          <Button disabled={busy} onClick={() => void send()}>{busy ? "Sending" : "Send request"}</Button>
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div> : null}
            </section>
          );
              }) : null}
            </section>
          );
        })}
        {query.isLoading ? <p className="text-stone-600">Loading…</p> : null}
        {!query.isLoading && visible.length === 0 ? <p className="text-stone-600">No submitted visits in this range.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
