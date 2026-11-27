import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import {
  DEFAULT_MILK_RUN_RATE,
  DEFAULT_WAREHOUSE_PICKUP_RATE,
  TRIP_PAY_EFFECTIVE_ON,
  duplicateKindMessage,
  sameDayKindTaken,
  tripKindLabel,
  validateTripDraft,
  type TripKind,
} from "../lib/trips";
import { torontoNow } from "../lib/dates";
import { Button, Card, ErrorText, Field, inputClass } from "../ui";

type TripRates = { pickup: number; milk: number; effectiveOn: string };

function moneyLabel(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function LogTripCard() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const queryClient = useQueryClient();
  const pendingGate = useRef(createPendingGate()).current;
  const today = torontoNow().today;
  const [kind, setKind] = useState<TripKind>("warehouse_pickup");
  const [day, setDay] = useState(today);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [milkCost, setMilkCost] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const sites = useQuery({ queryKey: ["sites-trips"], queryFn: loadSites });
  const logged = useQuery({
    queryKey: ["my-trip-slots", profile?.id, practice],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("trip_logs")
        .select("trip_on, kind, voided")
        .eq("person_id", profile!.id)
        .eq("is_sandbox", practice);
      if (queryError) return [] as { trip_on: string; kind: TripKind; voided?: boolean }[];
      return (data ?? []) as { trip_on: string; kind: TripKind; voided?: boolean }[];
    },
  });
  const rates = useQuery({
    queryKey: ["trip-rates"],
    queryFn: async (): Promise<TripRates> => {
      const { data, error: queryError } = await supabase
        .from("config")
        .select("key, value")
        .in("key", ["trip_rate_warehouse_pickup", "trip_rate_milk_run", "trip_pay_effective_on"]);
      if (queryError) return { pickup: DEFAULT_WAREHOUSE_PICKUP_RATE, milk: DEFAULT_MILK_RUN_RATE, effectiveOn: TRIP_PAY_EFFECTIVE_ON };
      const byKey = new Map((data ?? []).map((row) => [row.key as string, String(row.value ?? "")]));
      const pickup = Number(byKey.get("trip_rate_warehouse_pickup"));
      const milk = Number(byKey.get("trip_rate_milk_run"));
      return {
        pickup: Number.isFinite(pickup) ? pickup : DEFAULT_WAREHOUSE_PICKUP_RATE,
        milk: Number.isFinite(milk) ? milk : DEFAULT_MILK_RUN_RATE,
        effectiveOn: byKey.get("trip_pay_effective_on") || TRIP_PAY_EFFECTIVE_ON,
      };
    },
  });

  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice && site.active);
  const rate = rates.data ?? { pickup: DEFAULT_WAREHOUSE_PICKUP_RATE, milk: DEFAULT_MILK_RUN_RATE, effectiveOn: TRIP_PAY_EFFECTIVE_ON };
  const kindTaken = sameDayKindTaken(
    (logged.data ?? []).map((row) => ({ kind: row.kind, date: row.trip_on, voided: row.voided })),
    kind,
    day,
  );

  function toggleSite(id: string) {
    setSiteIds((current) => (current.includes(id) ? current.filter((site) => site !== id) : [...current, id]));
  }

  async function save() {
    await runPending(pendingGate, setBusy, "log-trip", async () => {
      const problem = validateTripDraft({
        kind,
        tripOn: day,
        siteIds,
        note,
        milkCost,
        receiptAttested: attested,
        today,
        effectiveOn: rate.effectiveOn,
      });
      if (problem) {
        setError(problem);
        return;
      }
      if (kindTaken) {
        setError(duplicateKindMessage(kind));
        return;
      }
      setError("");
      const { error: rpcError } = await supabase.rpc("log_trip", {
        p_kind: kind,
        p_on: day,
        p_sites: kind === "milk_run" ? siteIds : [],
        p_note: note,
        p_milk_cost: kind === "milk_run" ? Number(milkCost) : null,
        p_receipt_attested: kind === "milk_run" ? attested : false,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) {
        setError(turnedOff(rpcError, "log_trip") ? NOT_TURNED_ON : rpcError.message);
        return;
      }
      setNote("");
      setMilkCost("");
      setAttested(false);
      setSiteIds([]);
      await queryClient.invalidateQueries({ queryKey: ["my-trip-slots"] });
      await queryClient.invalidateQueries({ queryKey: ["my-trips"] });
      await queryClient.invalidateQueries({ queryKey: ["my-charges-pay"] });
      await queryClient.invalidateQueries({ queryKey: ["pay-trips"] });
      await queryClient.invalidateQueries({ queryKey: ["pay-charges"] });
    });
  }

  if (!profile || profile.role === "visitor") return null;

  return (
    <Card className="mb-4">
      <h2 className="text-lg font-semibold">Log a trip</h2>
      <p className="mt-1 text-sm text-stone-600">
        One warehouse pickup and one milk run a day. A pickup is {moneyLabel(rate.pickup)}. A milk run is {moneyLabel(rate.milk)}, once, plus the milk you paid for.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone={kind === "warehouse_pickup" ? "primary" : "quiet"} onClick={() => setKind("warehouse_pickup")}>
          Warehouse pickup
        </Button>
        <Button tone={kind === "milk_run" ? "primary" : "quiet"} onClick={() => setKind("milk_run")}>
          Milk run
        </Button>
      </div>
      <Field label="Day">
        <input className={inputClass} type="date" min={rate.effectiveOn} max={today} value={day} onChange={(event) => setDay(event.target.value)} />
      </Field>
      {kind === "milk_run" ? (
        <fieldset className="mb-4">
          <legend className="mb-1 text-sm font-medium text-stone-600">Sites</legend>
          <div className="grid gap-2">
            {modeSites.map((site) => (
              <label key={site.id} className="flex min-h-12 items-center gap-3 rounded-2xl bg-stone-50 px-3">
                <input
                  type="checkbox"
                  checked={siteIds.includes(site.id)}
                  onChange={() => toggleSite(site.id)}
                />
                <span className="font-medium">{site.short_name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Field label="Note (optional)">
        <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {kind === "milk_run" ? (
        <>
          <Field label="Milk cost">
            <input className={inputClass} inputMode="decimal" placeholder="0.00" value={milkCost} onChange={(event) => setMilkCost(event.target.value)} />
          </Field>
          <label className="mb-4 flex min-h-12 items-start gap-3 rounded-2xl bg-stone-50 px-3 py-3">
            <input type="checkbox" className="mt-1" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
            <span className="text-sm font-medium">I have the receipt and will hand it in</span>
          </label>
        </>
      ) : null}
      {kindTaken ? <p className="mb-3 text-sm font-medium text-amber-900">{duplicateKindMessage(kind)}</p> : null}
      <Button className="w-full" disabled={Boolean(busy) || kindTaken} onClick={() => void save()}>
        {busy === "log-trip" ? "Saving…" : `Save ${tripKindLabel(kind).toLowerCase()}`}
      </Button>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
