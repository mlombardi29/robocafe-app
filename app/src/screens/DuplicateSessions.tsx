import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatTorontoTime, formatWhen } from "../lib/dates";
import { findDuplicateClusters, type SessionDupRow } from "../lib/duplicateSessions";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { durationLabel, durationMinutes } from "../lib/timeRange";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Screen, Title } from "../ui";

type Named = { short_name?: string; goes_by?: string } | { short_name?: string; goes_by?: string }[] | null;

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

type LoadedRow = SessionDupRow & {
  sites: Named;
  people: Named;
};

export function DuplicateSessionsPage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [doneNote, setDoneNote] = useState("");
  const pendingGate = useRef(createPendingGate()).current;

  const query = useQuery({
    queryKey: ["duplicate-sessions"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("service_sessions")
        .select("id, site_id, person_id, service_date, start_at, end_at, status, created_at, sites(short_name), people(goes_by)")
        .neq("status", "voided")
        .order("service_date", { ascending: false })
        .limit(500);
      if (queryError) throw new Error(queryError.message);
      return { rows: (data ?? []) as LoadedRow[] };
    },
  });

  const clusters = findDuplicateClusters(query.data?.rows ?? []);

  async function voidCluster(keepId: string, voidIds: string[], reason: "same-start" | "race-window") {
    setError("");
    setDoneNote("");
    await runPending(pendingGate, setBusy, `void-${keepId}`, async () => {
      const how =
        reason === "race-window"
          ? "saved within three minutes of each other (old autosave/submit race)"
          : "filed twice with the same start time";
      for (const id of voidIds) {
        const { error: rpcError } = await supabase.rpc("void_session", {
          p_id: id,
          p_reason: `Duplicate of ${keepId}: one real service, two records (${how}). Kept the longer/more complete visit.`,
        });
        if (rpcError) {
          setError(rpcError.message);
          return;
        }
      }
      setDoneNote(`Voided ${voidIds.length} duplicate${voidIds.length === 1 ? "" : "s"}; kept one visit.`);
      await queryClient.invalidateQueries({ queryKey: ["duplicate-sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["history"] });
    });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Preview first. Nothing is deleted — duplicates are voided so hours are not counted twice.">
        Duplicate visits
      </Title>
      {doneNote ? <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{doneNote}</p> : null}
      <div className="mt-4 grid gap-4">
        {clusters.map((cluster) => {
          const keep = cluster.rows.find((row) => row.id === cluster.keepId);
          const siteName = one((keep as LoadedRow | undefined)?.sites)?.short_name ?? "Site";
          const personName = one((keep as LoadedRow | undefined)?.people)?.goes_by ?? "Tech";
          return (
            <Card key={cluster.key}>
              <p className="font-semibold">
                {personName} · {siteName} · {keep?.service_date}
              </p>
              <p className="text-sm text-stone-600">
                {cluster.reason === "same-start" ? "Same start time filed twice" : "Saved within 3 minutes (race)"}
              </p>
              <ul className="mt-3 grid gap-2">
                {cluster.rows.map((row) => {
                  const marked = row.id === cluster.keepId ? "Keep" : "Void";
                  return (
                    <li key={row.id} className="rounded-2xl bg-stone-50 px-3 py-2 text-sm">
                      <span className="font-semibold">{marked}</span>
                      {" · "}
                      {formatTorontoTime(row.start_at)} to {formatTorontoTime(row.end_at)}
                      {" · "}
                      {durationLabel(durationMinutes(row.start_at, row.end_at))}
                      {" · "}
                      {row.status}
                      <span className="block text-stone-500">Saved {formatWhen(row.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
              <Button
                className="mt-3"
                disabled={Boolean(busy)}
                onClick={() => void voidCluster(cluster.keepId, cluster.voidIds, cluster.reason)}
              >
                {busy === `void-${cluster.keepId}` ? "Voiding…" : `Void ${cluster.voidIds.length} duplicate${cluster.voidIds.length === 1 ? "" : "s"}`}
              </Button>
            </Card>
          );
        })}
        {query.isLoading ? <p className="text-stone-600">Looking for duplicates…</p> : null}
        {query.error ? <ErrorText>{query.error instanceof Error ? query.error.message : "Could not load visits."}</ErrorText> : null}
        {!query.isLoading && clusters.length === 0 ? <p className="text-stone-600">No duplicate visits found in the recent list.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
