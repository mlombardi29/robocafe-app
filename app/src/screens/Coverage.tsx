import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { canCancelCoverage, canClaimCoverage, coverageLabel, openCoverage, type CoverageRow } from "../lib/coverage";
import { torontoNow } from "../lib/dates";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

export function CoveragePage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const pendingGate = useRef(createPendingGate()).current;
  const today = torontoNow().today;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [siteId, setSiteId] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  const sites = useQuery({ queryKey: ["sites-coverage"], queryFn: loadSites });
  const people = useQuery({
    queryKey: ["people-coverage"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by").eq("active", true);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as { id: string; goes_by: string }[];
    },
  });
  const rows = useQuery({
    queryKey: ["coverage", practice],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("schedule_overrides")
        .select("id, site_id, service_date, coverage_requested, requested_by, claimed_by, note, is_sandbox")
        .eq("is_sandbox", practice)
        .order("service_date");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as (CoverageRow & { is_sandbox: boolean })[];
    },
  });

  const missing = turnedOff(rows.error as { message?: string } | null, "schedule_overrides");
  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const open = openCoverage(rows.data ?? [], today);

  function personName(id: string | null): string {
    if (!id) return "Someone";
    return people.data?.find((person) => person.id === id)?.goes_by ?? "Someone";
  }

  async function request() {
    await runPending(pendingGate, setBusy, "request", async () => {
      if (!siteId || !date) {
        setError("Pick a site and a date.");
        return;
      }
      setError("");
      const { error: rpcError } = await supabase.rpc("request_coverage", {
        p_site: siteId,
        p_date: date,
        p_note: note,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "request_coverage") ? NOT_TURNED_ON : rpcError.message);
      else {
        setNote("");
        await queryClient.invalidateQueries({ queryKey: ["coverage"] });
      }
    });
  }

  async function claim(row: CoverageRow) {
    await runPending(pendingGate, setBusy, `claim-${row.id}`, async () => {
      setError("");
      const { error: rpcError } = await supabase.rpc("claim_coverage", {
        p_site: row.site_id,
        p_date: row.service_date,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "claim_coverage") ? NOT_TURNED_ON : rpcError.message);
      else await queryClient.invalidateQueries({ queryKey: ["coverage"] });
    });
  }

  async function cancel(row: CoverageRow) {
    await runPending(pendingGate, setBusy, `cancel-${row.id}`, async () => {
      setError("");
      const { error: rpcError } = await supabase.rpc("cancel_coverage", {
        p_site: row.site_id,
        p_date: row.service_date,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "cancel_coverage") ? NOT_TURNED_ON : rpcError.message);
      else await queryClient.invalidateQueries({ queryKey: ["coverage"] });
    });
  }

  return (
    <Screen>
      <Link to={admin ? "/admin" : "/"} className="text-sm font-semibold text-[var(--accent)]">{admin ? "Admin" : "Home"}</Link>
      <Title sub="Ask for help on a visit day, claim an open ask, or cancel yours. No email is sent from here.">Coverage</Title>
      {missing ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <Card>
        <h2 className="font-semibold">Request coverage</h2>
        <p className="mt-1 text-sm text-stone-600">Original assignee stays blank until schedules assign people. No pay rule is applied here.</p>
        <Field label="Site">
          <select className={inputClass} value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">Choose</option>
            {modeSites.map((site) => (
              <option key={site.id} value={site.id}>{site.short_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
        </Field>
        <Button disabled={Boolean(busy)} onClick={() => void request()}>{busy === "request" ? "Saving…" : "Request coverage"}</Button>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">Open requests</h2>
        <p className="mt-1 text-sm text-stone-600">Past dates hide automatically. Claiming clears the open ask.</p>
        <div className="mt-3 grid gap-3">
          {open.length === 0 ? <p className="text-sm text-stone-500">Nothing open.</p> : null}
          {open.map((row) => {
            const siteName = modeSites.find((site) => site.id === row.site_id)?.short_name ?? "Site";
            return (
              <div key={row.id} className="rounded-2xl bg-stone-50 px-3 py-3">
                <p className="font-semibold">{siteName} · {row.service_date}</p>
                <p className="text-sm text-stone-600">{coverageLabel(row, profile?.id ?? null)} · asked by {personName(row.requested_by)}</p>
                {row.note ? <p className="text-sm text-stone-600">{row.note}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {canClaimCoverage(row, profile?.id ?? null) ? (
                    <Button tone="quiet" disabled={Boolean(busy)} onClick={() => void claim(row)}>
                      {busy === `claim-${row.id}` ? "Saving…" : "Claim"}
                    </Button>
                  ) : null}
                  {canCancelCoverage(row, profile?.id ?? null, admin) ? (
                    <Button tone="quiet" disabled={Boolean(busy)} onClick={() => void cancel(row)}>
                      {busy === `cancel-${row.id}` ? "Saving…" : "Cancel"}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
