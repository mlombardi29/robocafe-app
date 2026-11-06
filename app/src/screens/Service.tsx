import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { loadService, type LocalVisit } from "../data";
import { inPractice } from "../lib/access";
import { formatTorontoTime, formatWhen, instantOnTorontoDay, torontoNow } from "../lib/dates";
import { evaluateDue } from "../lib/due";
import { offerFreshStart } from "../lib/freshPractice";
import { milkCleanRunning, milkStepLocks } from "../lib/milkLock";
import type { CompletionWrite } from "../lib/queue";
import { TIMER_DONE_LABEL } from "../lib/buttonStyles";
import { checklistCardsClass, checklistStackClass } from "../lib/checklistLayout";
import { CLOCK_OUT_SAVED, COMPLETE_QUEUED, SUCCESS_TOAST_MS, completeFollowUp, successToast, unfinishedRequired, visibleEndNotice, type EndNotice } from "../lib/serviceFlow";
import { enqueue, enqueueAndFlush, flushQueue, forgetVisit, rememberVisit, stableKey, startFreshPractice } from "../lib/sync";
import { supabase } from "../lib/supabase";
import type { SnapItem } from "../lib/types";
import { Button, CheckItem, ErrorText, FreshPracticeDialog, MilkStepCard, Screen } from "../ui";

export function ServicePage() {
  const { siteId = "" } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["service", siteId, profile?.id],
    enabled: Boolean(profile && siteId),
    queryFn: () => loadService(siteId, profile!.id),
  });
  const [rows, setRows] = useState<Record<string, CompletionWrite>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [milkStart, setMilkStart] = useState<string | null>(null);
  const [milkDone, setMilkDone] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [override, setOverride] = useState(false);
  const [pendingMilk, setPendingMilk] = useState<SnapItem | null>(null);
  const [reason, setReason] = useState("");
  const [estimate, setEstimate] = useState(false);
  const [estimateTime, setEstimateTime] = useState("09:00");
  const [endNotice, setEndNotice] = useState<EndNotice | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [freshAsk, setFreshAsk] = useState(false);
  const [freshError, setFreshError] = useState("");
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveError, setLeaveError] = useState("");
  const [closedNote, setClosedNote] = useState("");
  const freshNewId = useRef<string | null>(null);
  const dialogOpen = useRef(false);
  dialogOpen.current = leaveAsk || override || estimate || freshAsk;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!successToast(endNotice)) return;
    const timer = window.setTimeout(() => setEndNotice(null), SUCCESS_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [endNotice]);

  useEffect(() => {
    if (!query.data) return;
    const map: Record<string, CompletionWrite> = {};
    for (const row of query.data.completions) map[row.itemId] = row;
    setRows(map);
    setSessionId(query.data.session?.id ?? null);
    setMilkStart(query.data.session?.milk_clean_started_at ?? null);
    setMilkDone(query.data.session?.milk_clean_done_at ?? null);
  }, [query.data]);

  const snapshot = query.data?.snapshot;
  const minutes = snapshot?.milk_clean_minutes ?? query.data?.site.models?.milk_clean_minutes ?? 0;
  const milkEnds = milkStart ? new Date(milkStart).getTime() + minutes * 60_000 : null;
  const milkRunning = milkCleanRunning(milkStart, milkDone, minutes, now);
  const milkLeft = milkEnds ? Math.max(0, milkEnds - now) : 0;

  const settings = useMemo(() => {
    const map = new Map<string, { value: number | null; unit: string | null }>();
    for (const row of query.data?.settings ?? []) {
      map.set(row.item_id, { value: row.threshold_value, unit: row.threshold_unit });
    }
    return map;
  }, [query.data]);
  const lastDone = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of query.data?.state ?? []) map.set(row.item_id, row.last_done_at);
    return map;
  }, [query.data]);

  const today = torontoNow().today;
  const groups = (snapshot?.sections ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((section) => ({
      ...section,
      items: section.items
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((item) => {
          const setting = settings.get(item.id);
          const due = evaluateDue(
            {
              key: item.key,
              cadenceType: item.cadence_type,
              cadenceDays: item.cadence_days,
              status: item.status,
              thresholdValue: setting?.value ?? null,
              thresholdUnit: setting?.unit ?? null,
            },
            lastDone.get(item.id) ?? null,
            today,
          );
          return { item, due };
        })
        .filter((entry) => entry.due.show),
    }))
    .filter((section) => section.items.length > 0);

  const missingSteps = useMemo(
    () =>
      unfinishedRequired(
        groups.flatMap((section) => section.items.map((entry) => entry.item)),
        Object.fromEntries(Object.values(rows).map((row) => [row.itemId, row.state])),
        milkStart,
      ),
    [groups, rows, milkStart],
  );

  async function persist(next: Record<string, CompletionWrite>, visit: Partial<LocalVisit>) {
    const sid = visit.sessionId !== undefined ? visit.sessionId : sessionId;
    const completions = sid ? Object.values(next).filter((row) => row.sessionId === sid) : [];
    const rest: Partial<LocalVisit> = { ...visit };
    delete rest.completions;
    await rememberVisit(siteId, {
      milkStartedAt: milkStart,
      milkDoneAt: milkDone,
      ...rest,
      sessionId: sid,
      completions,
    });
  }

  function rowsForSession(id: string, source: Record<string, CompletionWrite> = rows) {
    const kept: Record<string, CompletionWrite> = {};
    for (const [key, row] of Object.entries(source)) {
      if (row.sessionId === id) kept[key] = row;
    }
    return kept;
  }

  async function ensureSession(estimated = false, at?: string): Promise<string> {
    if (sessionId && query.data?.session) return sessionId;
    const id = sessionId ?? crypto.randomUUID();
    const start = at ?? new Date().toISOString();
    const kept = rowsForSession(id);
    setRows(kept);
    setSessionId(id);
    setMilkStart(null);
    setMilkDone(null);
    await enqueue({ kind: "start", id, siteId, start, estimated });
    await persist(kept, { sessionId: id, milkStartedAt: null, milkDoneAt: null });
    await flushQueue();
    return id;
  }

  async function mark(item: SnapItem, state: "done" | "not_needed", forcedSessionId?: string) {
    const id = forcedSessionId ?? sessionId ?? query.data?.session?.id;
    if (!id) {
      setError("Tap Start now first.");
      return;
    }
    setError("");
    const prev = rows[item.id];
    const write: CompletionWrite = {
      sessionId: id,
      itemId: item.id,
      idempotencyKey: prev?.idempotencyKey ?? (await stableKey(id, item.id)),
      clientRev: (prev?.clientRev ?? 0) + 1,
      state,
      note: prev?.note ?? "",
      overrideReason: prev?.overrideReason ?? "",
      value: prev?.value ?? "",
    };
    let next: Record<string, CompletionWrite> = {};
    setRows((current) => {
      next = { ...current, [item.id]: write };
      return next;
    });
    setBusy(item.id);
    try {
      await persist(next, { sessionId: id });
      await enqueue({ kind: "completion", write, stepKey: item.key });
      await flushQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved on this phone. It will sync when you are online.");
    } finally {
      setBusy("");
    }
  }

  async function startNow() {
    setBusy("start");
    setError("");
    try {
      await ensureSession(false);
      await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start.");
    } finally {
      setBusy("");
    }
  }

  async function endNow() {
    const id = sessionId ?? query.data?.session?.id;
    if (!id) {
      setEndNotice({ kind: "error", iso: new Date().toISOString(), detail: "Tap Start now before ending the visit." });
      return;
    }
    setBusy("end");
    setError("");
    const end = new Date().toISOString();
    try {
      const result = await enqueueAndFlush({ kind: "end", id, end });
      if (result.ok) {
        if (!dialogOpen.current) setEndNotice({ kind: "saved", iso: end });
      } else if (result.retry) {
        setEndNotice({ kind: "queued", iso: end, detail: result.error ?? "It will sync when you are online." });
      } else {
        setEndNotice({ kind: "error", iso: end, detail: result.error ?? "End time was not saved." });
      }
      if (result.ok) await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
    } catch (err) {
      setEndNotice({
        kind: "error",
        iso: end,
        detail: err instanceof Error ? err.message : "End time was not saved.",
      });
    } finally {
      setBusy("");
    }
  }

  async function abandonVisit() {
    const id = sessionId ?? query.data?.session?.id;
    if (!id || leaveReason.trim().length < 3) {
      setLeaveError("Say why you cannot finish this visit.");
      return;
    }
    setBusy("abandon");
    setLeaveError("");
    const { error: rpcError } = await supabase.rpc("abandon_visit", { p_id: id, p_reason: leaveReason.trim() });
    if (rpcError) {
      const missing = rpcError.code === "PGRST202" || /abandon_visit/i.test(rpcError.message);
      setLeaveError(missing ? "Closing a visit this way is not turned on yet. Nothing was closed." : rpcError.message);
      setBusy("");
      return;
    }
    await forgetVisit(siteId);
    setRows({});
    setSessionId(null);
    setMilkStart(null);
    setMilkDone(null);
    setLeaveAsk(false);
    setLeaveReason("");
    setClosedNote("This visit was closed without completing. You can start a new one.");
    setBusy("");
    await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
  }

  async function startMilk(item: SnapItem, overrideReason: string | null) {
    const id = await ensureSession(false);
    const blockers = groups.flatMap((section) => section.items).filter((entry) => entry.item.blocks_clean_start);
    const missing = blockers.filter((entry) => {
      const row = rows[entry.item.id];
      const state = row?.sessionId === id ? row.state : undefined;
      return state !== "done" && state !== "not_needed";
    });
    if (missing.length > 0 && !overrideReason) {
      setPendingMilk(item);
      setOverride(true);
      return;
    }
    setBusy("milk");
    setError("");
    try {
      const result = await enqueueAndFlush({ kind: "milk", id, action: "start", reason: overrideReason });
      if (!result.ok) {
        setError(result.error ?? "Could not start milk cleaning.");
        if (!result.retry) await flushQueue();
        return;
      }
      const started = new Date().toISOString();
      setMilkStart(started);
      await persist(rowsForSession(id), { sessionId: id, milkStartedAt: started });
      await mark(item, "done", id);
      setOverride(false);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start milk cleaning.");
    } finally {
      setBusy("");
    }
  }

  async function finishMilk() {
    const id = sessionId ?? query.data?.session?.id;
    if (!id) return;
    setBusy("milk-done");
    const doneAt = new Date().toISOString();
    setMilkDone(doneAt);
    await enqueue({ kind: "milk", id, action: "done", reason: null });
    await persist(rows, { milkDoneAt: doneAt });
    await flushQueue();
    setBusy("");
  }

  function askFresh() {
    if (busy === "fresh") return;
    freshNewId.current = crypto.randomUUID();
    setFreshError("");
    setFreshAsk(true);
  }

  async function confirmFresh() {
    const retired = query.data?.session?.id;
    const newId = freshNewId.current;
    if (!retired || !newId || busy === "fresh") return;
    setBusy("fresh");
    setFreshError("");
    let adopted: string | null = null;
    try {
      const result = await startFreshPractice(retired, newId, new Date().toISOString());
      if (!result.ok || !result.sessionId) {
        setFreshError(result.message || "Could not start a fresh practice visit. This visit was not changed.");
        return;
      }
      adopted = result.sessionId;
      await rememberVisit(siteId, {
        sessionId: result.sessionId,
        completions: [],
        milkStartedAt: null,
        milkDoneAt: null,
      });
      setRows({});
      setMilkStart(null);
      setMilkDone(null);
      setSessionId(result.sessionId);
      setShowBlocked(false);
      setEndNotice(null);
      setFreshAsk(false);
    } catch (err) {
      setFreshError(err instanceof Error ? err.message : "Could not start a fresh practice visit. This visit was not changed.");
    } finally {
      if (adopted) await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
      setBusy("");
    }
  }

  function focusStep(itemId: string) {
    const card = document.getElementById(`step-${itemId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(itemId);
    card.focus({ preventScroll: true });
    window.setTimeout(() => {
      setHighlightId((current) => (current === itemId ? null : current));
    }, 2500);
  }

  async function complete(withEstimate: boolean) {
    setBusy("complete");
    setError("");
    try {
      const openRequired = unfinishedRequired(
        groups.flatMap((section) => section.items.map((entry) => entry.item)),
        Object.fromEntries(Object.values(rows).map((row) => [row.itemId, row.state])),
        milkStart,
      );
      if (openRequired.length > 0) {
        setShowBlocked(true);
        window.setTimeout(() => focusStep(openRequired[0].id), 0);
        return;
      }
      setShowBlocked(false);
      let id = sessionId ?? query.data?.session?.id ?? null;
      let estimateIso: string | null = null;
      if (!query.data?.session?.start_at) {
        if (!withEstimate) {
          setEstimate(true);
          return;
        }
        estimateIso = instantOnTorontoDay(today, estimateTime);
        id = await ensureSession(true, estimateIso);
      }
      if (!id) return;
      const result = await enqueueAndFlush({ kind: "complete", id, end: null, estimate: estimateIso });
      setEstimate(false);
      if (completeFollowUp(result) !== "home") {
        setError(result.retry ? COMPLETE_QUEUED : result.error ?? "Could not complete the visit. This visit is still open.");
        return;
      }
      await forgetVisit(siteId);
      await queryClient.invalidateQueries({ queryKey: ["recent"] });
      await queryClient.invalidateQueries({ queryKey: ["service", siteId] });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the visit.");
    } finally {
      setBusy("");
    }
  }

  if (query.isLoading) {
    return (
      <Screen>
        <p className="text-stone-600">Loading the visit…</p>
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen>
        <ErrorText>{query.error instanceof Error ? query.error.message : "Could not open this site."}</ErrorText>
        <Link to="/" className="mt-4 inline-block font-semibold text-[var(--accent)]">Back home</Link>
      </Screen>
    );
  }

  const started = Boolean(query.data.session?.start_at || sessionId);
  const submitted = Boolean(query.data.session?.submitted_at);
  const toast = visibleEndNotice(endNotice, leaveAsk || override || estimate || freshAsk);

  return (
    <Screen>
      <Link to="/" className="text-sm font-semibold text-[var(--accent)]">Home</Link>
      <h1 className="mt-2 text-3xl font-semibold">{query.data.site.short_name}</h1>
      <p className="text-stone-600">{query.data.site.name}</p>
      {query.data.session?.start_at ? (
        <p className="mt-2 text-sm text-stone-600">
          Started {formatWhen(query.data.session.start_at)}
          {query.data.session.start_estimated ? " (estimated)" : ""}
          {query.data.session.end_at || endNotice?.kind === "saved"
            ? ` · Ended ${formatWhen(query.data.session.end_at ?? (endNotice?.kind === "saved" ? endNotice.iso : null))}`
            : ""}
        </p>
      ) : null}
      {milkRunning ? <div className="h-16" aria-hidden="true" /> : null}
      {milkRunning ? (
        <div className="fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-[480px] px-4 pt-2">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-stone-900 px-3 py-2 text-white shadow-lg">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-300">Milk cleaning</p>
              <p className="text-2xl font-semibold leading-none">
                {`${String(Math.floor(milkLeft / 60000)).padStart(2, "0")}:${String(Math.floor((milkLeft % 60000) / 1000)).padStart(2, "0")}`}
              </p>
            </div>
            <Button tone="quiet" className="min-h-11 shrink-0 px-3" disabled={busy === "milk-done"} onClick={() => void finishMilk()}>
              {TIMER_DONE_LABEL}
            </Button>
          </div>
        </div>
      ) : null}
      {closedNote ? <p className="mt-3 rounded-2xl bg-amber-100 px-3 py-3 text-base font-semibold text-stone-900">{closedNote}</p> : null}
      {offerFreshStart(
        Boolean(profile && inPractice(profile.role, profile.mode)),
        Boolean(query.data.site.is_sandbox),
        Boolean(query.data.session?.id) && !submitted,
      ) ? (
        <Button tone="quiet" className="mt-3 w-full" disabled={busy === "fresh"} onClick={askFresh}>
          Start a fresh practice visit
        </Button>
      ) : null}
      {milkStart && !milkRunning ? (
        <div className="mt-3 rounded-2xl bg-stone-900 px-3 py-3 text-white">
          <p className="text-sm uppercase tracking-wide text-stone-300">Milk cleaning</p>
          <p className="text-3xl font-semibold">
            {milkDone || milkLeft === 0
              ? "Done"
              : `${String(Math.floor(milkLeft / 60000)).padStart(2, "0")}:${String(Math.floor((milkLeft % 60000) / 1000)).padStart(2, "0")}`}
          </p>
          {!milkDone ? (
            <Button tone="quiet" className="mt-3" disabled={busy === "milk-done"} onClick={() => void finishMilk()}>
              {TIMER_DONE_LABEL}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={checklistStackClass}>
        {groups.map((section) => (
          <section key={section.id}>
            <h2 className="mb-1.5 text-sm font-bold uppercase tracking-wide text-stone-500">{section.title}</h2>
            <div className={checklistCardsClass}>
              {section.items.map(({ item, due }) => {
                const locks = milkStepLocks(
                  { key: item.key, lockedDuringClean: item.locked_during_clean },
                  milkRunning,
                );
                return item.key === "start_milk_clean" ? (
                  <MilkStepCard
                    key={item.id}
                    stepId={`step-${item.id}`}
                    highlighted={highlightId === item.id}
                    title={item.title}
                    details={item.details}
                    minutes={minutes}
                    started={Boolean(milkStart)}
                    countedDone={Boolean(milkStart) && rows[item.id]?.state !== "not_needed"}
                    notNeeded={rows[item.id]?.state === "not_needed"}
                    startDisabled={Boolean(milkStart) || submitted || busy === "milk"}
                    skipDisabled={submitted || busy === item.id}
                    onStart={() => void startMilk(item, null)}
                    onSkip={() => void mark(item, "not_needed")}
                  />
                ) : (
                  <CheckItem
                    key={item.id}
                    stepId={`step-${item.id}`}
                    highlighted={highlightId === item.id}
                    title={item.title}
                    detail={due.detail}
                    howTo={item.details}
                    placeholder={due.placeholder}
                    overdue={due.overdue}
                    due={due.due}
                    doneLocked={locks.doneLocked}
                    skipLocked={locks.notNeededLocked}
                    lockMessage={locks.message}
                    state={rows[item.id]?.state}
                    note={rows[item.id]?.note}
                    disabled={!started || submitted || busy === item.id}
                    onDone={() => void mark(item, "done")}
                    onSkip={() => void mark(item, "not_needed")}
                    onNote={(note) => {
                      const prev = rows[item.id];
                      if (!prev) return;
                      const write = { ...prev, note, clientRev: prev.clientRev + 1 };
                      const next = { ...rows, [item.id]: write };
                      setRows(next);
                      void persist(next, {}).then(() => enqueue({ kind: "completion", write, stepKey: item.key })).then(() => flushQueue());
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {submitted ? (
        <p className="mt-6 text-sm text-stone-600">Submitted. Times are locked. Use My time if something needs a correction.</p>
      ) : null}
      {showBlocked && missingSteps.length > 0 ? (
        <div className="mt-3 grid gap-2" role="alert">
          <p className="text-sm font-medium text-red-700">Still open. Tap a step to go to it.</p>
          {missingSteps.map((step) => (
            <button
              key={step.id}
              type="button"
              className="min-h-12 rounded-2xl bg-red-50 px-3 text-left text-base font-semibold text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              onClick={() => focusStep(step.id)}
            >
              {step.title}
            </button>
          ))}
        </div>
      ) : (
        <ErrorText>{error}</ErrorText>
      )}

      {freshAsk ? (
        <FreshPracticeDialog
          error={freshError}
          busy={busy === "fresh"}
          onClose={() => {
            if (busy === "fresh") return;
            setFreshAsk(false);
            setFreshError("");
          }}
          onConfirm={() => void confirmFresh()}
        />
      ) : null}

      {override ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="mx-auto w-full max-w-[480px] rounded-3xl bg-white p-4">
            <h2 className="text-xl font-semibold">Prep is not finished</h2>
            <p className="mt-2 text-sm text-stone-600">Finish those steps, or start anyway and say why.</p>
            <textarea className="mt-3 min-h-24 w-full rounded-2xl border border-stone-200 p-3" value={reason} onChange={(event) => setReason(event.target.value)} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button tone="quiet" onClick={() => setOverride(false)}>Go back</Button>
              <Button disabled={reason.trim().length < 3 || !pendingMilk} onClick={() => pendingMilk && void startMilk(pendingMilk, reason.trim())}>Start anyway</Button>
            </div>
          </div>
        </div>
      ) : null}

      {leaveAsk ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="mx-auto w-full max-w-[480px] rounded-3xl bg-white p-4">
            <h2 id="leave-title" className="text-xl font-semibold">Incomplete today?</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Are you sure? This does not finish the checklist. It closes the visit for today so a new one can start here. Payroll can see it later as incomplete.
            </p>
            {leaveError ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{leaveError}</p> : null}
            <label className="mt-3 block text-sm font-medium text-stone-600">
              Reason
              <textarea className="mt-1 min-h-24 w-full rounded-2xl border border-stone-200 p-3 text-base" value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} />
            </label>
            <div className="mt-3 grid gap-2">
              <Button disabled={busy === "abandon" || leaveReason.trim().length < 3} onClick={() => void abandonVisit()}>
                Are you sure? Close this visit
              </Button>
              <Button tone="quiet" disabled={busy === "abandon"} onClick={() => setLeaveAsk(false)}>Go back</Button>
            </div>
          </div>
        </div>
      ) : null}

      {estimate ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="mx-auto w-full max-w-[480px] rounded-3xl bg-white p-4">
            <h2 className="text-xl font-semibold">What time did you arrive?</h2>
            <p className="mt-2 text-sm text-stone-600">Next time, tap Start now when you arrive.</p>
            <input className="mt-3 min-h-12 w-full rounded-2xl border border-stone-200 px-3" type="time" value={estimateTime} onChange={(event) => setEstimateTime(event.target.value)} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button tone="quiet" onClick={() => setEstimate(false)}>Back</Button>
              <Button onClick={() => void complete(true)}>Save</Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="fixed inset-x-0 z-30 mx-auto w-full max-w-[480px] px-4" style={{ bottom: "var(--nav-stack)" }}>
        {toast ? (
          <p className="mb-2 rounded-2xl bg-amber-100 px-3 py-3 text-base font-semibold text-stone-900 shadow-sm ring-1 ring-amber-300" aria-live="polite">
            {toast.kind === "saved" ? `Paused. Clock-out saved at ${formatTorontoTime(toast.iso)}. ${CLOCK_OUT_SAVED} Resume it from Home.` : null}
            {toast.kind === "queued"
              ? `Saved on this phone (${formatWhen(toast.iso)}). It will sync when you are online.`
              : null}
            {toast.kind === "error" ? toast.detail : null}
          </p>
        ) : null}
        {!started ? (
          <Button className="w-full shadow-lg" disabled={busy === "start" || submitted} onClick={() => void startNow()}>
            Start now
          </Button>
        ) : !submitted ? (
          <div className="grid gap-2">
            <Button className="w-full shadow-lg" disabled={busy === "complete"} onClick={() => void complete(false)}>
              Complete servicing
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button tone="quiet" className="shadow-lg" disabled={busy === "end"} onClick={() => void endNow()}>
                Pause servicing
              </Button>
              <Button tone="quiet" className="shadow-lg" disabled={busy === "abandon"} onClick={() => { setLeaveError(""); setEndNotice((current) => (successToast(current) ? null : current)); setLeaveAsk(true); }}>
                Incomplete today
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Screen>
  );
}
