import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../auth";
import { formatWhen } from "../lib/dates";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

const SIX_HOURS = 6 * 60 * 60 * 1000;

type Session = {
  id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  submitted_at: string | null;
  status: string;
  sites: { short_name: string } | { short_name: string }[] | null;
};

export function TimePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ["my-time", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("service_sessions")
        .select("id, service_date, start_at, end_at, submitted_at, status, sites(short_name)")
        .eq("person_id", profile!.id)
        .eq("status", "completed")
        .order("service_date", { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Session[];
    },
  });

  async function send() {
    if (!openId || reason.trim().length < 3) {
      setError("Say what should change.");
      return;
    }
    setBusy(true);
    setError("");
    const day = query.data?.find((row) => row.id === openId)?.service_date;
    const { error: insertError } = await supabase.from("time_corrections").insert({
      session_id: openId,
      requested_by: profile!.id,
      reason: reason.trim(),
      requested_start: start && day ? new Date(`${day}T${start}`).toISOString() : null,
      requested_end: end && day ? new Date(`${day}T${end}`).toISOString() : null,
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
  }

  return (
    <Screen>
      <Title sub="Submitted times stay locked. Ask an admin to change one.">My time</Title>
      <div className="grid gap-3">
        {(query.data ?? []).map((row) => {
          const site = Array.isArray(row.sites) ? row.sites[0] : row.sites;
          const long =
            row.start_at && row.end_at && new Date(row.end_at).getTime() - new Date(row.start_at).getTime() > SIX_HOURS;
          return (
            <Card key={row.id}>
              <p className="font-semibold">{site?.short_name ?? "Visit"} · {row.service_date}</p>
              <p className="text-sm text-stone-600">
                {formatWhen(row.start_at)} to {formatWhen(row.end_at)}
              </p>
              {long ? <p className="mt-1 text-sm font-medium text-amber-800">Over 6 hours. Check AM/PM.</p> : null}
              <Button className="mt-3" tone="quiet" onClick={() => setOpenId(row.id)}>
                Request a correction
              </Button>
              {openId === row.id ? (
                <div className="mt-3">
                  <Field label="What should change?">
                    <textarea className={`${inputClass} min-h-24 py-3`} value={reason} onChange={(event) => setReason(event.target.value)} />
                  </Field>
                  <Field label="Requested start">
                    <input className={inputClass} type="time" value={start} onChange={(event) => setStart(event.target.value)} />
                  </Field>
                  <Field label="Requested end">
                    <input className={inputClass} type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
                  </Field>
                  <Button disabled={busy} onClick={() => void send()}>
                    {busy ? "Sending" : "Send request"}
                  </Button>
                </div>
              ) : null}
            </Card>
          );
        })}
        {query.isLoading ? <p className="text-stone-600">Loading…</p> : null}
        {!query.isLoading && (query.data ?? []).length === 0 ? <p className="text-stone-600">No submitted visits yet.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
