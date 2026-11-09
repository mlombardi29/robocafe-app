import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { inPractice } from "../lib/access";
import { formatClockRange, formatVisitDay } from "../lib/correctionGlance";
import { torontoNow } from "../lib/dates";
import { isCoveredShift, lineAmount, money, rateForDay, ratesForShiftPay, type PayRate } from "../lib/pay";
import { payPdf } from "../lib/payPdf";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { durationMinutes, rangeBounds } from "../lib/timeRange";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

type Person = { id: string; goes_by: string; role: string };
type Shift = {
  id: string;
  person_id: string;
  site_id: string;
  service_date: string;
  start_at: string | null;
  end_at: string | null;
  is_sandbox: boolean;
  sites: { short_name: string } | { short_name: string }[] | null;
};
type CoverageClaim = { site_id: string; service_date: string; claimed_by: string | null; is_sandbox: boolean };
type RateRow = { person_id: string; hourly_rate: number; effective_on: string; is_sandbox: boolean };
type PayRow = {
  id: string;
  person_id: string;
  amount: number | null;
  status: string;
  period_start: string | null;
  period_end: string | null;
  paid_on: string | null;
  is_sandbox: boolean;
  voided?: boolean;
};

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function PayrollPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const queryClient = useQueryClient();
  const today = torontoNow().today;
  const week = rangeBounds("past-week", today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [paidOn, setPaidOn] = useState(today);

  const people = useQuery({
    queryKey: ["pay-people"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by, role").eq("active", true).order("goes_by");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Person[];
    },
  });
  const shifts = useQuery({
    queryKey: ["pay-shifts", week.from, week.to],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("service_sessions")
        .select("id, person_id, site_id, service_date, start_at, end_at, is_sandbox, sites(short_name)")
        .eq("status", "completed")
        .gte("service_date", week.from)
        .lte("service_date", week.to);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Shift[];
    },
  });
  const claims = useQuery({
    queryKey: ["pay-coverage", week.from, week.to, practice],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("schedule_overrides")
        .select("site_id, service_date, claimed_by, is_sandbox")
        .eq("is_sandbox", practice)
        .gte("service_date", week.from)
        .lte("service_date", week.to)
        .not("claimed_by", "is", null);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as CoverageClaim[];
    },
  });
  const rates = useQuery({
    queryKey: ["pay-rates"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("pay_rates").select("person_id, hourly_rate, effective_on, is_sandbox");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as RateRow[];
    },
  });
  const runs = useQuery({
    queryKey: ["pay-runs", week.from, week.to],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("payments")
        .select("id, person_id, amount, status, period_start, period_end, paid_on, is_sandbox")
        .eq("period_start", week.from)
        .eq("period_end", week.to);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as PayRow[];
    },
  });

  const notReady = [rates.error, runs.error].some((item) => turnedOff(item as { message?: string } | null, "pay_rates") || turnedOff(item as { message?: string } | null, "period_start"));
  const visibleShifts = (shifts.data ?? []).filter((row) => row.is_sandbox === practice);
  const byPerson = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const row of visibleShifts) map.set(row.person_id, [...(map.get(row.person_id) ?? []), row]);
    return map;
  }, [visibleShifts]);

  function ratesFor(personId: string): PayRate[] {
    return (rates.data ?? [])
      .filter((row) => row.person_id === personId && row.is_sandbox === practice)
      .map((row) => ({ effectiveOn: row.effective_on, hourlyRate: Number(row.hourly_rate) }));
  }

  function included(shift: Shift): boolean {
    return picked[shift.id] !== false;
  }

  async function save(personId: string, personShifts: Shift[]) {
    setBusy(personId);
    setError("");
    const ids = personShifts.filter(included).map((row) => row.id);
    const { error: rpcError } = await supabase.rpc("save_pay_run", {
      p_person: personId,
      p_start: week.from,
      p_end: week.to,
      p_sessions: ids,
      p_key: crypto.randomUUID(),
    });
    setBusy("");
    if (rpcError) {
      setError(turnedOff(rpcError, "save_pay_run") ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["pay-runs"] });
  }

  async function mark(id: string, status: "submitted" | "paid") {
    setBusy(id + status);
    setError("");
    const { error: rpcError } = await supabase.rpc("mark_pay_run", {
      p_id: id,
      p_status: status,
      p_paid_on: status === "paid" ? paidOn : null,
    });
    setBusy("");
    if (rpcError) setError(turnedOff(rpcError, "mark_pay_run") ? NOT_TURNED_ON : rpcError.message);
    else await queryClient.invalidateQueries({ queryKey: ["pay-runs"] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub={`${week.from} to ${week.to}. Times already include approved corrections. Covered shifts pay the tech who worked them at that tech's own hourly rate.`}>
        {practice ? "Practice pay" : "Last week's pay"}
      </Title>
      <Link to="/admin/payroll/rates" className="mb-4 inline-block font-semibold text-[var(--accent)]">Pay rates</Link>
      {notReady ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      {turnedOff(claims.error as { message?: string } | null, "schedule_overrides") ? (
        <p className="mb-3 text-sm text-stone-600">Coverage labels need migration 0017. Pay still uses each worker's own rate.</p>
      ) : null}
      <Field label="Date paid">
        <input className={inputClass} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
      </Field>
      <div className="grid gap-3">
        {[...byPerson.entries()].map(([personId, personShifts]) => {
          const person = (people.data ?? []).find((row) => row.id === personId);
          const run = (runs.data ?? []).find((row) => row.person_id === personId && row.is_sandbox === practice && !row.voided);
          let total = 0;
          return (
            <Card key={personId}>
              <p className="text-lg font-semibold">{person?.goes_by ?? "Person"}</p>
              {personShifts.map((shift) => {
                const minutes = durationMinutes(shift.start_at, shift.end_at);
                const rate = rateForDay(ratesForShiftPay(ratesFor(personId)), shift.service_date);
                const amount = minutes != null && rate != null ? lineAmount(minutes, rate) : null;
                if (included(shift) && amount != null) total += amount;
                const site = one(shift.sites);
                const covered = isCoveredShift(claims.data ?? [], shift.site_id, shift.service_date, shift.person_id);
                return (
                  <label key={shift.id} className="mt-3 flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={included(shift)}
                      onChange={(event) => setPicked((current) => ({ ...current, [shift.id]: event.target.checked }))}
                    />
                    <span>
                      <span className="block font-medium">{formatVisitDay(shift.service_date)} · {site?.short_name ?? "Visit"}</span>
                      <span className="block text-sm text-stone-600">
                        {formatClockRange(shift.start_at, shift.end_at)} · {minutes ?? "?"} min
                        {amount == null ? " · No rate for this day" : ` · ${money(amount)}`}
                        {covered ? " · Covered shift · worker's rate" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
              <p className="mt-3 text-lg font-semibold">{money(Math.round(total * 100) / 100)}</p>
              {run ? <p className="text-sm text-stone-600">{run.status}{run.paid_on ? ` · paid ${run.paid_on}` : ""} · saved {money(run.amount)}</p> : null}
              <div className="mt-3 grid gap-2">
                <Button disabled={busy === personId || run?.status === "paid"} onClick={() => void save(personId, personShifts)}>Save checked shifts</Button>
                {run && run.status !== "paid" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button tone="quiet" disabled={busy.startsWith(run.id)} onClick={() => void mark(run.id, "submitted")}>Mark submitted</Button>
                    <Button tone="quiet" disabled={busy.startsWith(run.id)} onClick={() => void mark(run.id, "paid")}>Mark paid</Button>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
        {!shifts.isLoading && byPerson.size === 0 ? <p className="text-stone-600">No completed shifts in that week.</p> : null}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

export function PayRatesPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const queryClient = useQueryClient();
  const [personId, setPersonId] = useState("");
  const [rate, setRate] = useState("");
  const [effective, setEffective] = useState(torontoNow().today);
  const [error, setError] = useState("");
  const people = useQuery({
    queryKey: ["pay-people"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by, role").eq("active", true).order("goes_by");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Person[];
    },
  });
  const rates = useQuery({
    queryKey: ["pay-rates"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("pay_rates").select("person_id, hourly_rate, effective_on, is_sandbox").order("effective_on", { ascending: false });
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as RateRow[];
    },
  });

  async function save() {
    const amount = Number(rate);
    if (!personId || !Number.isFinite(amount) || amount < 0) {
      setError("Pick a person and a rate.");
      return;
    }
    setError("");
    const { error: rpcError } = await supabase.rpc("set_pay_rate", {
      p_person: personId,
      p_rate: amount,
      p_effective: effective,
      p_key: crypto.randomUUID(),
    });
    if (rpcError) setError(turnedOff(rpcError, "set_pay_rate") ? NOT_TURNED_ON : rpcError.message);
    else {
      setRate("");
      await queryClient.invalidateQueries({ queryKey: ["pay-rates"] });
    }
  }

  const rows = (rates.data ?? []).filter((row) => row.is_sandbox === practice);
  return (
    <Screen>
      <Link to="/admin/payroll" className="text-sm font-semibold text-[var(--accent)]">Payroll</Link>
      <Title sub={practice ? "Practice rates stay off live pay." : "Live rates. A later date replaces the earlier one from that day on."}>Pay rates</Title>
      {turnedOff(rates.error as { message?: string } | null, "pay_rates") ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <Field label="Person">
        <select className={inputClass} value={personId} onChange={(event) => setPersonId(event.target.value)}>
          <option value="">Choose</option>
          {(people.data ?? []).map((person) => <option key={person.id} value={person.id}>{person.goes_by}</option>)}
        </select>
      </Field>
      <Field label="Hourly rate">
        <input className={inputClass} inputMode="decimal" placeholder="Blank" value={rate} onChange={(event) => setRate(event.target.value)} />
      </Field>
      <Field label="Starts on">
        <input className={inputClass} type="date" value={effective} onChange={(event) => setEffective(event.target.value)} />
      </Field>
      <Button onClick={() => void save()}>Save rate</Button>
      <div className="mt-4 grid gap-2">
        {rows.map((row) => (
          <p key={`${row.person_id}-${row.effective_on}`} className="text-sm">
            {(people.data ?? []).find((person) => person.id === row.person_id)?.goes_by ?? "Person"} · {money(Number(row.hourly_rate))} from {row.effective_on}
          </p>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}

type Line = {
  minutes: number;
  amount: number;
  service_sessions: {
    service_date: string;
    start_at: string | null;
    end_at: string | null;
    sites: { short_name: string } | { short_name: string }[] | null;
  } | null;
};

export function TechPayPage() {
  const { profile } = useAuth();
  const query = useQuery({
    queryKey: ["my-pay", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, status, period_start, period_end, paid_on, is_sandbox, payment_lines(minutes, amount, service_sessions(service_date, start_at, end_at, sites(short_name)))")
        .eq("person_id", profile!.id)
        .order("period_end", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  function download(row: {
    amount: number | string | null;
    period_start: string | null;
    period_end: string | null;
    paid_on: string | null;
    payment_lines: { minutes: number; amount: number; service_sessions: unknown }[] | null;
  }) {
    const lines = (row.payment_lines ?? []).map((line) => {
      const session = one(line.service_sessions as Line["service_sessions"]);
      return {
        day: session ? formatVisitDay(session.service_date) : "Shift",
        when: session ? formatClockRange(session.start_at, session.end_at) : "",
        minutes: Number(line.minutes),
        amount: Number(line.amount),
      };
    });
    const text = payPdf({
      person: profile?.goes_by ?? "Pay",
      periodStart: row.period_start ?? "",
      periodEnd: row.period_end ?? "",
      paidOn: row.paid_on ?? "",
      lines,
      total: Number(row.amount ?? 0),
    });
    const url = URL.createObjectURL(new Blob([text], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pay-${row.period_start ?? "statement"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Screen>
      <Link to="/time" className="text-sm font-semibold text-[var(--accent)]">My time</Link>
      <Title sub="Paid weeks only include shifts an admin checked and marked paid.">Your pay</Title>
      {turnedOff(query.error as { message?: string } | null, "payment_lines") ? <p className="text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <div className="grid gap-3">
        {(query.data ?? []).map((row) => (
          <Card key={row.id}>
            <p className="font-semibold">{money(row.amount == null ? null : Number(row.amount))}</p>
            <p className="text-sm text-stone-600">
              {row.period_start} to {row.period_end}
              {row.paid_on ? ` · paid ${row.paid_on}` : ""} · {row.status}
            </p>
            {row.status === "paid" ? <Button className="mt-3" tone="quiet" onClick={() => download(row)}>Download PDF</Button> : null}
          </Card>
        ))}
        {!query.isLoading && (query.data ?? []).length === 0 ? <p className="text-stone-600">No pay runs yet.</p> : null}
      </div>
      <ErrorText>{query.error && !turnedOff(query.error as { message?: string }, "payment_lines") ? (query.error as Error).message : ""}</ErrorText>
    </Screen>
  );
}
