import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { inPractice } from "../lib/access";
import { formatClockRange, formatVisitDay } from "../lib/correctionGlance";
import { torontoNow } from "../lib/dates";
import { amountForWorkedShift, hourlyRateForWorkedShift, isCoveredShift, money, type PayRate } from "../lib/pay";
import { ChargesPage } from "./Charges";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { durationLabel, durationMinutes, rangeBounds } from "../lib/timeRange";
import { buildPayPeriod, currentPayPeriod, inPayPeriod, pastPayPeriods, sumMoney, type PayPeriodDetail, type PayWindow, type PeriodTrip } from "../lib/payPeriod";
import { tripKindLabel, tripSitesLabel } from "../lib/trips";
import { LogTripCard } from "./LogTrip";
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
type PayCharge = {
  id: string;
  person_id: string;
  amount: number | null;
  note: string | null;
  created_at: string | null;
  voided?: boolean;
  paid?: boolean;
  is_sandbox?: boolean;
  trip_log_id?: string | null;
  payment_id?: string | null;
};
type TechCharge = {
  id: string;
  amount: number | null;
  note: string | null;
  created_at: string | null;
  voided?: boolean;
  paid?: boolean;
  trip_log_id?: string | null;
};
type TripSiteEmbed = {
  site_id: string;
  sites: { short_name: string } | { short_name: string }[] | null;
};
type TechTrip = {
  id: string;
  person_id: string;
  trip_on: string;
  kind: "warehouse_pickup" | "milk_run";
  rate_amount: number | null;
  note: string | null;
  milk_cost: number | null;
  receipt_received_at: string | null;
  voided?: boolean;
  created_at?: string;
  payment_id?: string | null;
  trip_log_sites?: TripSiteEmbed[] | null;
};

function siteName(value: TripSiteEmbed["sites"]): string {
  const row = one(value);
  return row?.short_name ?? "";
}

function asPeriodTrip(row: TechTrip): PeriodTrip {
  const sites = (row.trip_log_sites ?? []).map((link) => siteName(link.sites)).filter(Boolean);
  return {
    id: row.id,
    date: row.trip_on,
    kind: row.kind,
    sites,
    note: row.note?.trim() || "",
    amount: row.rate_amount == null ? null : Number(row.rate_amount),
    voided: Boolean(row.voided),
    milkCost: row.milk_cost == null ? null : Number(row.milk_cost),
    receiptReceived: Boolean(row.receipt_received_at),
    createdAt: row.created_at,
    personId: row.person_id,
  };
}

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
  payment_lines?: { session_id: string }[] | null;
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
        .select("id, person_id, amount, status, period_start, period_end, paid_on, is_sandbox, payment_lines(session_id)")
        .eq("period_start", week.from)
        .eq("period_end", week.to);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as PayRow[];
    },
  });
  const trips = useQuery({
    queryKey: ["pay-trips", week.from, week.to, practice],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("trip_logs")
        .select("id, person_id, trip_on, kind, rate_amount, note, milk_cost, receipt_received_at, voided, created_at, payment_id, trip_log_sites(site_id, sites(short_name))")
        .eq("is_sandbox", practice)
        .gte("trip_on", week.from)
        .lte("trip_on", week.to);
      if (queryError) return [] as TechTrip[];
      return (data ?? []) as TechTrip[];
    },
  });
  const charges = useQuery({
    queryKey: ["pay-charges", practice],
    queryFn: async () => {
      const full = await supabase
        .from("charges")
        .select("id, person_id, amount, note, created_at, voided, paid, is_sandbox, trip_log_id, payment_id")
        .eq("is_sandbox", practice);
      if (!full.error) return (full.data ?? []) as PayCharge[];
      const basic = await supabase
        .from("charges")
        .select("id, person_id, amount, note, created_at, paid, is_sandbox")
        .eq("is_sandbox", practice);
      if (basic.error) return [] as PayCharge[];
      return ((basic.data ?? []) as PayCharge[]).map((row) => ({ ...row, voided: false, trip_log_id: null, payment_id: null }));
    },
  });

  const visibleShifts = (shifts.data ?? []).filter((row) => row.is_sandbox === practice);
  const visibleTrips = useMemo(() => trips.data ?? [], [trips.data]);
  const visibleCharges = useMemo(() => charges.data ?? [], [charges.data]);
  const tripById = useMemo(() => new Map(visibleTrips.map((row) => [row.id, row])), [visibleTrips]);
  const personIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of visibleShifts) ids.add(row.person_id);
    for (const row of visibleTrips) if (!row.voided) ids.add(row.person_id);
    for (const row of visibleCharges) {
      if (row.voided) continue;
      const trip = row.trip_log_id ? tripById.get(row.trip_log_id) : undefined;
      const date = trip?.trip_on || (row.created_at ? torontoNow(new Date(row.created_at)).today : "");
      if (inPayPeriod(date, week)) ids.add(row.person_id);
    }
    return [...ids];
  }, [visibleShifts, visibleTrips, visibleCharges, tripById, week]);

  function ratesFor(personId: string): PayRate[] {
    return (rates.data ?? [])
      .filter((row) => row.person_id === personId && row.is_sandbox === practice)
      .map((row) => ({ effectiveOn: row.effective_on, hourlyRate: Number(row.hourly_rate) }));
  }

  function included(shift: Shift): boolean {
    return picked[shift.id] !== false;
  }

  async function markPaid(personId: string, personShifts: Shift[], existingId: string | undefined, locked: boolean, hasOtherPay: boolean) {
    setBusy(personId);
    setError("");
    let id = existingId;
    if (!locked) {
      const ids = personShifts.filter(included).map((row) => row.id);
      if (ids.length === 0 && !hasOtherPay) {
        setBusy("");
        setError("Nothing to pay for this person.");
        return;
      }
      const { data, error: rpcError } = await supabase.rpc("save_pay_run", {
        p_person: personId,
        p_start: week.from,
        p_end: week.to,
        p_sessions: ids,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) {
        setBusy("");
        setError(turnedOff(rpcError, "save_pay_run") ? NOT_TURNED_ON : rpcError.message);
        return;
      }
      const saved = data as { id?: string } | { id?: string }[] | null;
      id = (Array.isArray(saved) ? saved[0]?.id : saved?.id) ?? id;
    }
    if (!id) {
      setBusy("");
      setError("Could not find this pay.");
      return;
    }
    const { error: markError } = await supabase.rpc("mark_pay_run", {
      p_id: id,
      p_status: "paid",
      p_paid_on: paidOn,
    });
    setBusy("");
    if (markError) setError(turnedOff(markError, "mark_pay_run") ? NOT_TURNED_ON : markError.message);
    else {
      await queryClient.invalidateQueries({ queryKey: ["pay-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["pay-trips"] });
      await queryClient.invalidateQueries({ queryKey: ["pay-charges"] });
    }
  }

  async function changeTrip(id: string, action: "void" | "receipt") {
    if (action === "void" && !window.confirm("Remove this trip? Its flat pay comes off this week. An unpaid milk reimbursement is removed too.")) return;
    setBusy(id);
    setError("");
    const fn = action === "void" ? "void_trip" : "set_trip_receipt";
    const args = action === "void"
      ? { p_id: id, p_key: crypto.randomUUID() }
      : { p_id: id, p_received: true, p_key: crypto.randomUUID() };
    const { error: rpcError } = await supabase.rpc(fn, args);
    setBusy("");
    if (rpcError) {
      setError(turnedOff(rpcError, fn) ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["pay-trips"] });
    await queryClient.invalidateQueries({ queryKey: ["pay-charges"] });
  }

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub={`${week.from} to ${week.to}. Shifts stay hourly. Trips are a flat rate. Reimbursements are listed on their own. A covered shift pays the person who worked it, at their own rate.`}>
        {practice ? "Practice pay" : "Payroll"}
      </Title>
      <Link to="/admin/payroll/rates" className="mb-4 inline-block font-semibold text-[var(--accent)]">Pay rates</Link>
      <Field label="Date paid">
        <input className={inputClass} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
      </Field>
      <div className="grid gap-3">
        {personIds.map((personId) => {
          const person = (people.data ?? []).find((row) => row.id === personId);
          const personShifts = visibleShifts.filter((row) => row.person_id === personId);
          const run = (runs.data ?? []).find((row) => row.person_id === personId && row.is_sandbox === practice && !row.voided);
          const locked = run?.status === "submitted" || run?.status === "paid";
          const paid = run?.status === "paid";
          const paidIds = new Set((run?.payment_lines ?? []).map((line) => line.session_id));
          let shiftTotal = 0;
          const period = buildPayPeriod({
            from: week.from,
            to: week.to,
            shifts: [],
            trips: visibleTrips.filter((row) => row.person_id === personId).map((row) => ({
              ...asPeriodTrip(row),
              paymentStatus: row.payment_id && paid ? "paid" : null,
            })),
            reimbursements: visibleCharges.filter((row) => row.person_id === personId && !row.voided).map((row) => {
              const trip = row.trip_log_id ? tripById.get(row.trip_log_id) : undefined;
              const held = Boolean(trip && !trip.voided && !trip.receipt_received_at);
              return {
                date: trip?.trip_on || (row.created_at ? torontoNow(new Date(row.created_at)).today : ""),
                note: row.note?.trim() || "Reimbursement",
                amount: row.amount == null ? null : Number(row.amount),
                held,
                alreadyPaid: Boolean(row.paid) && !held,
              };
            }),
          });
          const payableReimbursements = sumMoney([period.reimbursementsTotal, -period.alreadyPaidTotal]);
          const hasOtherPay = period.trips.length > 0 || payableReimbursements > 0;
          return (
            <Card key={personId}>
              <p className="text-lg font-semibold">{person?.goes_by ?? "Person"}</p>
              <h3 className="mt-3 font-semibold">Shifts</h3>
              {personShifts.length === 0 ? <p className="text-sm text-stone-600">No shifts</p> : null}
              {personShifts.map((shift) => {
                const minutes = durationMinutes(shift.start_at, shift.end_at);
                const workerRates = ratesFor(personId);
                const rate = hourlyRateForWorkedShift(workerRates, shift.service_date);
                const amount = amountForWorkedShift({ workerRates, minutes, day: shift.service_date });
                const paying = locked && paidIds.size > 0 ? paidIds.has(shift.id) : included(shift);
                if (paying && amount != null) shiftTotal += amount;
                const site = one(shift.sites);
                const covered = isCoveredShift(claims.data ?? [], shift.site_id, shift.service_date, shift.person_id);
                return (
                  <div key={shift.id} className="mt-3">
                    <p className="font-medium">{formatVisitDay(shift.service_date)} · {site?.short_name ?? "Visit"}</p>
                    <p className="text-sm text-stone-600">
                      {formatClockRange(shift.start_at, shift.end_at)} · {minutes ?? "?"} min
                      {rate == null ? " · No rate for this day" : ` · ${money(rate)}/hr · ${amount == null ? "No amount" : money(amount)}`}
                      {` · ${covered ? "Covered" : "Scheduled"}`}
                    </p>
                    {paid ? (
                      <p className="mt-1 text-sm font-semibold text-emerald-800">{paying ? "Paid" : "Not yet paid"}</p>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Button tone={paying ? "primary" : "quiet"} disabled={locked || Boolean(busy)} onClick={() => setPicked((current) => ({ ...current, [shift.id]: true }))}>
                          Pay
                        </Button>
                        <Button tone={!paying ? "primary" : "quiet"} disabled={locked || Boolean(busy)} onClick={() => setPicked((current) => ({ ...current, [shift.id]: false }))}>
                          Not yet paid
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="mt-2 font-semibold">Shifts {money(Math.round(shiftTotal * 100) / 100)}</p>
              <h3 className="mt-4 font-semibold">Trips</h3>
              {period.trips.length === 0 ? <p className="text-sm text-stone-600">No trips</p> : null}
              {period.trips.map((trip) => (
                <div key={trip.id ?? `${trip.date}-${trip.kind}`} className="mt-3">
                  <p className="font-medium">
                    {formatVisitDay(trip.date)} · {tripKindLabel(trip.kind)}
                    {trip.sites.length ? ` · ${tripSitesLabel(trip.sites)}` : ""}
                  </p>
                  <p className="text-sm text-stone-600">
                    {trip.amount == null ? "" : money(trip.amount)}
                    {trip.note ? ` · ${trip.note}` : ""}
                    {trip.kind === "milk_run" && trip.receiptReceived === false ? " · Receipt not in yet" : ""}
                    {trip.kind === "milk_run" && trip.receiptReceived ? " · Receipt in" : ""}
                  </p>
                  {trip.kind === "milk_run" && trip.id && trip.receiptReceived === false ? (
                    <Button className="mt-2" tone="quiet" disabled={Boolean(busy)} onClick={() => void changeTrip(trip.id!, "receipt")}>
                      {busy === trip.id ? "Saving…" : "Receipt received"}
                    </Button>
                  ) : null}
                  {!paid && trip.id ? (
                    <Button className="mt-2" tone="quiet" disabled={Boolean(busy)} onClick={() => void changeTrip(trip.id!, "void")}>
                      Remove trip
                    </Button>
                  ) : null}
                </div>
              ))}
              <p className="mt-2 font-semibold">Trips {money(period.tripsTotal)}</p>
              <h3 className="mt-4 font-semibold">Reimbursements</h3>
              {period.reimbursements.length === 0 ? <p className="text-sm text-stone-600">No reimbursements</p> : null}
              {period.reimbursements.map((row) => (
                <div key={`${row.date}-${row.note}-${row.amount}`} className="mt-3">
                  <p className="font-medium">{row.note}</p>
                  <p className="text-sm text-stone-600">
                    {formatVisitDay(row.date)}
                    {row.amount == null ? "" : ` · ${money(row.amount)}`}
                    {row.held ? " · Waiting for receipt" : ""}
                    {row.alreadyPaid ? " · Paid" : ""}
                  </p>
                </div>
              ))}
              <p className="mt-2 font-semibold">Reimbursements {money(period.reimbursementsTotal)}</p>
              <p className="mt-3 text-lg font-semibold">
                {paid ? "Paid" : "To pay"} {money(sumMoney([Math.round(shiftTotal * 100) / 100, period.tripsTotal, period.reimbursementsTotal]))}
              </p>
              {period.alreadyPaidTotal > 0 ? (
                <p className="text-sm text-stone-600">
                  Includes {money(period.alreadyPaidTotal)} already paid on Charges. Marking this week paid will not pay that again.
                </p>
              ) : null}
              {run?.paid_on ? <p className="text-sm text-stone-600">Paid {run.paid_on}</p> : null}
              {paid ? null : (
                <Button className="mt-3 w-full" disabled={busy === personId} onClick={() => void markPaid(personId, personShifts, run?.id, Boolean(locked), hasOtherPay)}>
                  {busy === personId ? "Saving…" : "Mark paid"}
                </Button>
              )}
            </Card>
          );
        })}
        {!shifts.isLoading && !trips.isLoading && personIds.length === 0 ? <p className="text-stone-600">Nothing to pay in that week.</p> : null}
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
      <Title sub={practice ? "Practice rates stay off live pay." : "The rate used is the latest one dated on or before the shift."}>Pay rates</Title>
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

export function PayHome() {
  const [params, setParams] = useSearchParams();
  const reimbursements = params.get("tab") === "reimbursements";
  return (
    <Screen>
      {reimbursements ? (
        <>
          <button type="button" className="mb-3 text-sm font-semibold text-[var(--accent)]" onClick={() => setParams({})}>
            Your pay
          </button>
          <ChargesPage embedded />
        </>
      ) : (
        <TechPayList />
      )}
    </Screen>
  );
}

function TechPayList() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = torontoNow().today;
  const current = currentPayPeriod(today);
  const requested = params.get("period");
  const selected = requested ? currentPayPeriod(requested) : current;
  const viewingCurrent = selected.from === current.from;
  const practice = profile ? inPractice(profile.role, profile.mode) : false;

  const sessions = useQuery({
    queryKey: ["my-shifts", profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_sessions")
        .select("id, service_date, start_at, end_at, site_id, sites(short_name)")
        .eq("person_id", profile!.id)
        .eq("status", "completed")
        .order("service_date", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const charges = useQuery({
    queryKey: ["my-charges-pay", profile?.id, practice],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("charges")
        .select("id, amount, note, created_at, voided, paid, is_sandbox, trip_log_id")
        .eq("person_id", profile!.id)
        .eq("is_sandbox", practice);
      if (error) return [] as TechCharge[];
      return (data ?? []) as TechCharge[];
    },
  });
  const trips = useQuery({
    queryKey: ["my-trips", profile?.id, practice],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trip_logs")
        .select("id, person_id, trip_on, kind, rate_amount, note, milk_cost, receipt_received_at, voided, created_at, payment_id, trip_log_sites(site_id, sites(short_name))")
        .eq("person_id", profile!.id)
        .eq("is_sandbox", practice);
      if (error) return [] as TechTrip[];
      return (data ?? []) as TechTrip[];
    },
  });
  const rates = useQuery({
    queryKey: ["my-rates", profile?.id, practice],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pay_rates")
        .select("hourly_rate, effective_on, is_sandbox")
        .eq("person_id", profile!.id)
        .eq("is_sandbox", practice);
      if (error) return [] as { hourly_rate: number; effective_on: string }[];
      return (data ?? []) as { hourly_rate: number; effective_on: string }[];
    },
  });

  const workerRates = (rates.data ?? []).map((row) => ({ effectiveOn: row.effective_on, hourlyRate: Number(row.hourly_rate) }));
  const shifts = (sessions.data ?? []).map((row) => {
    const site = one(row.sites as { short_name: string } | { short_name: string }[] | null);
    const minutes = durationMinutes(row.start_at, row.end_at);
    return {
      date: row.service_date as string,
      site: site?.short_name ?? "Visit",
      minutes,
      amount: amountForWorkedShift({ workerRates, minutes, day: row.service_date as string }),
    };
  });
  const tripRows = (trips.data ?? []).map(asPeriodTrip);
  const tripById = new Map((trips.data ?? []).map((row) => [row.id, row]));
  const reimbursements = (charges.data ?? [])
    .filter((row) => !row.voided)
    .map((row) => {
      const trip = row.trip_log_id ? tripById.get(row.trip_log_id) : undefined;
      const held = Boolean(trip && !trip.voided && !trip.receipt_received_at);
      return {
        date: trip?.trip_on || (row.created_at ? torontoNow(new Date(row.created_at)).today : ""),
        note: row.note?.trim() || "Reimbursement",
        amount: row.amount == null ? null : Number(row.amount),
        held,
        alreadyPaid: Boolean(row.paid) && !held,
      };
    });
  const detail = buildPayPeriod({ ...selected, shifts, trips: tripRows, reimbursements });
  const past = pastPayPeriods(today, [
    ...shifts.map((row) => row.date),
    ...tripRows.map((row) => row.date),
    ...reimbursements.map((row) => row.date),
  ]);

  return (
    <>
    <LogTripCard />
    <PayPeriodDetailView
      heading={viewingCurrent ? "This period" : "Past period"}
      detail={detail}
      past={viewingCurrent ? past : []}
      onPast={(period) => setParams({ period: period.from })}
      onCurrent={viewingCurrent ? undefined : () => setParams({})}
      error={sessions.error instanceof Error ? sessions.error.message : ""}
    />
    </>
  );
}

function PaySection({
  title,
  empty,
  total,
  rows,
}: {
  title: string;
  empty: string;
  total: number;
  rows: { key: string; title: string; detail: string }[];
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="text-lg font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="mt-1 text-sm text-stone-600">{empty}</p> : null}
      <ul className="mt-2 grid gap-3">
        {rows.map((row) => (
          <li key={row.key}>
            <p className="font-semibold">{row.title}</p>
            {row.detail ? <p className="text-sm text-stone-600">{row.detail}</p> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 font-semibold">{title} {money(total)}</p>
    </section>
  );
}

export function PayPeriodDetailView({
  heading,
  detail,
  past,
  onPast,
  onCurrent,
  error,
}: {
  heading: string;
  detail: PayPeriodDetail;
  past: PayWindow[];
  onPast?: (period: PayWindow) => void;
  onCurrent?: () => void;
  error?: string;
}) {
  return (
    <>
      {onCurrent ? (
        <button type="button" className="mb-3 text-sm font-semibold text-[var(--accent)]" onClick={onCurrent}>
          This period
        </button>
      ) : null}
      <Title sub={`${formatVisitDay(detail.from)} – ${formatVisitDay(detail.to)}`}>Your pay</Title>
      <h2 className="mb-3 text-xl font-semibold">{heading}</h2>
      <Card>
        <PaySection
          title="Shifts"
          empty="No shifts"
          total={detail.shiftsTotal}
          rows={detail.shifts.map((shift) => ({
            key: `${shift.date}-${shift.site}-${shift.minutes}`,
            title: `${formatVisitDay(shift.date)} · ${shift.site}`,
            detail: `${durationLabel(shift.minutes)}${shift.amount == null ? "" : ` · ${money(shift.amount)}`}`,
          }))}
        />
        <PaySection
          title="Trips"
          empty="No trips"
          total={detail.tripsTotal}
          rows={detail.trips.map((trip) => ({
            key: trip.id ?? `${trip.date}-${trip.kind}-${trip.sites.join("-")}`,
            title: `${formatVisitDay(trip.date)} · ${tripKindLabel(trip.kind)}${trip.sites.length ? ` · ${tripSitesLabel(trip.sites)}` : ""}`,
            detail: [
              trip.amount == null ? "" : money(trip.amount),
              trip.note,
              trip.kind === "milk_run" && trip.milkCost != null ? `Milk cost ${money(trip.milkCost)} is under Reimbursements` : "",
              trip.kind === "milk_run" && trip.receiptReceived === false ? "Receipt not in yet" : "",
            ].filter(Boolean).join(" · "),
          }))}
        />
        <PaySection
          title="Reimbursements"
          empty="No reimbursements"
          total={detail.reimbursementsTotal}
          rows={detail.reimbursements.map((row) => ({
            key: `${row.date}-${row.note}-${row.amount}`,
            title: row.note,
            detail: [
              formatVisitDay(row.date),
              row.amount == null ? "" : money(row.amount),
              row.held ? "Waiting for receipt" : "",
              row.alreadyPaid ? "Paid" : "",
            ].filter(Boolean).join(" · "),
          }))}
        />
        <p className="mt-4 text-xl font-semibold">Total {money(detail.total)}</p>
      </Card>
      {past.length > 0 ? (
        <section className="mt-5">
          <h2 className="mb-2 text-xl font-semibold">Past periods</h2>
          <div className="grid gap-2">
            {past.map((period) => (
              <button
                key={period.from}
                type="button"
                className="flex min-h-14 items-center justify-between rounded-2xl bg-white px-4 text-left text-base font-semibold shadow-sm ring-1 ring-black/5"
                onClick={() => onPast?.(period)}
              >
                <span>{formatVisitDay(period.from)} – {formatVisitDay(period.to)}</span>
                <span className="text-[var(--accent)]">Open</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <Link to="/pay?tab=reimbursements" className="mt-4 inline-block text-base font-semibold text-[var(--accent)]">Log a charge</Link>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
