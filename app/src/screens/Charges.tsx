import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { money, normalizeReceiptUrl, parseChargeAmount, unpaidCharges, type ChargeRow } from "../lib/charges";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

export function ChargesPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const pendingGate = useRef(createPendingGate()).current;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [amount, setAmount] = useState("");
  const [siteId, setSiteId] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState("");

  const sites = useQuery({ queryKey: ["sites-charges"], queryFn: loadSites });
  const people = useQuery({
    queryKey: ["people-charges"],
    enabled: admin,
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("people").select("id, goes_by").eq("active", true);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as { id: string; goes_by: string }[];
    },
  });
  const charges = useQuery({
    queryKey: ["charges", practice, admin, profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      let query = supabase
        .from("charges")
        .select("id, person_id, site_id, amount, note, receipt_url, paid, created_at, is_sandbox")
        .eq("is_sandbox", practice)
        .order("created_at", { ascending: false });
      if (!admin && profile?.id) query = query.eq("person_id", profile.id);
      const { data, error: queryError } = await query;
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as (ChargeRow & { is_sandbox: boolean })[];
    },
  });

  const missing = turnedOff(charges.error as { message?: string } | null, "charges") || turnedOff(charges.error as { message?: string } | null, "add_charge");
  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const unpaid = unpaidCharges(charges.data ?? []);

  function personName(id: string): string {
    if (id === profile?.id) return "You";
    return people.data?.find((person) => person.id === id)?.goes_by ?? "Someone";
  }

  async function add() {
    await runPending(pendingGate, setBusy, "add", async () => {
      const parsed = parseChargeAmount(amount);
      if (parsed == null) {
        setError("Enter a positive amount.");
        return;
      }
      setError("");
      const { error: rpcError } = await supabase.rpc("add_charge", {
        p_amount: parsed,
        p_site: siteId || null,
        p_note: note,
        p_receipt_url: normalizeReceiptUrl(receipt),
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "add_charge") ? NOT_TURNED_ON : rpcError.message);
      else {
        setAmount("");
        setNote("");
        setReceipt("");
        await queryClient.invalidateQueries({ queryKey: ["charges"] });
      }
    });
  }

  async function markPaid(row: ChargeRow, paid: boolean) {
    await runPending(pendingGate, setBusy, `paid-${row.id}`, async () => {
      setError("");
      const { error: rpcError } = await supabase.rpc("set_charge_paid", {
        p_id: row.id,
        p_paid: paid,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "set_charge_paid") ? NOT_TURNED_ON : rpcError.message);
      else await queryClient.invalidateQueries({ queryKey: ["charges"] });
    });
  }

  return (
    <Screen>
      <Link to={admin ? "/admin" : "/"} className="text-sm font-semibold text-[var(--accent)]">{admin ? "Admin" : "Home"}</Link>
      <Title sub="Log a purchase for reimbursement. Receipt link is optional until Drive upload is turned on. No email is sent.">Labour & reimbursements</Title>
      {missing ? <p className="mb-3 text-sm font-medium text-amber-800">{NOT_TURNED_ON}</p> : null}
      <p className="mb-3 text-sm text-stone-600">
        Hours from completed visits stay on <Link className="font-semibold text-[var(--accent)]" to={admin ? "/admin/payroll" : "/pay"}>{admin ? "Payroll" : "Your pay"}</Link>.
        Approval limits and who is unpaid are not decided here.
      </p>
      <Card>
        <h2 className="font-semibold">Add a charge</h2>
        <Field label="Amount">
          <input className={inputClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <Field label="Site (optional)">
          <select className={inputClass} value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">None</option>
            {modeSites.map((site) => (
              <option key={site.id} value={site.id}>{site.short_name}</option>
            ))}
          </select>
        </Field>
        <Field label="What for">
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. milk" />
        </Field>
        <Field label="Receipt link (optional)">
          <input className={inputClass} value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder="Blank until Drive is configured" />
        </Field>
        <Button disabled={Boolean(busy)} onClick={() => void add()}>{busy === "add" ? "Saving…" : "Save charge"}</Button>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">Unpaid</h2>
        <div className="mt-3 grid gap-3">
          {unpaid.length === 0 ? <p className="text-sm text-stone-500">Nothing unpaid.</p> : null}
          {unpaid.map((row) => {
            const siteName = row.site_id ? modeSites.find((site) => site.id === row.site_id)?.short_name : null;
            return (
              <div key={row.id} className="rounded-2xl bg-stone-50 px-3 py-3">
                <p className="font-semibold">{money(row.amount)} · {personName(row.person_id)}</p>
                <p className="text-sm text-stone-600">
                  {row.note || "No note"}
                  {siteName ? ` · ${siteName}` : ""}
                </p>
                {row.receipt_url ? (
                  <a className="text-sm font-semibold text-[var(--accent)]" href={row.receipt_url} target="_blank" rel="noreferrer">
                    Receipt link
                  </a>
                ) : (
                  <p className="text-sm text-stone-500">No receipt link yet</p>
                )}
                {admin ? (
                  <Button className="mt-2" tone="quiet" disabled={Boolean(busy)} onClick={() => void markPaid(row, true)}>
                    {busy === `paid-${row.id}` ? "Saving…" : "Mark paid"}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
      {admin ? (
        <Card className="mt-4">
          <h2 className="font-semibold">Recently paid</h2>
          <div className="mt-3 grid gap-2">
            {(charges.data ?? [])
              .filter((row) => row.paid)
              .slice(0, 8)
              .map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{money(row.amount)} · {personName(row.person_id)} · {row.note || "No note"}</span>
                  <Button tone="quiet" className="min-h-10 px-3 text-sm" disabled={Boolean(busy)} onClick={() => void markPaid(row, false)}>
                    Undo
                  </Button>
                </div>
              ))}
          </div>
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
