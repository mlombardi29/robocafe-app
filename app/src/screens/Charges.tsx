import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import {
  chargeEditAccess,
  chargeEditLockedLabel,
  money,
  normalizeReceiptUrl,
  parseChargeAmount,
  unpaidCharges,
  type ChargeRow,
} from "../lib/charges";
import { formatWhen } from "../lib/dates";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

type EditDraft = {
  id: string;
  amount: string;
  siteId: string;
  note: string;
  receipt: string;
  paid: boolean;
};

export function ChargesPage({ embedded = false }: { embedded?: boolean }) {
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
  const [edit, setEdit] = useState<EditDraft | null>(null);

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
      const full = await supabase
        .from("charges")
        .select("id, person_id, site_id, amount, note, receipt_url, paid, voided, created_at, edited_at, edited_by, is_sandbox")
        .eq("is_sandbox", practice)
        .order("created_at", { ascending: false });
      if (!full.error) {
        let rows = (full.data ?? []) as (ChargeRow & { is_sandbox: boolean })[];
        if (!admin && profile?.id) rows = rows.filter((row) => row.person_id === profile.id);
        return rows;
      }
      if (!/voided|edited_at|schema cache|does not exist/i.test(full.error.message)) {
        throw new Error(full.error.message);
      }
      let query = supabase
        .from("charges")
        .select("id, person_id, site_id, amount, note, receipt_url, paid, created_at, is_sandbox")
        .eq("is_sandbox", practice)
        .order("created_at", { ascending: false });
      if (!admin && profile?.id) query = query.eq("person_id", profile.id);
      const { data, error: queryError } = await query;
      if (queryError) throw new Error(queryError.message);
      return ((data ?? []) as (ChargeRow & { is_sandbox: boolean })[]).map((row) => ({
        ...row,
        voided: false,
        edited_at: null,
        edited_by: null,
      }));
    },
  });

  const modeSites = (sites.data ?? []).filter((site) => site.is_sandbox === practice);
  const unpaid = unpaidCharges(charges.data ?? []);

  function personName(id: string): string {
    if (id === profile?.id) return "You";
    return people.data?.find((person) => person.id === id)?.goes_by ?? "Someone";
  }

  function openEdit(row: ChargeRow) {
    setError("");
    setEdit({
      id: row.id,
      amount: row.amount == null ? "" : String(row.amount),
      siteId: row.site_id ?? "",
      note: row.note ?? "",
      receipt: row.receipt_url ?? "",
      paid: row.paid,
    });
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
        p_receipt_url: null,
        p_key: crypto.randomUUID(),
      });
      if (rpcError) setError(turnedOff(rpcError, "add_charge") ? NOT_TURNED_ON : rpcError.message);
      else {
        setAmount("");
        setNote("");
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

  async function saveEdit() {
    if (!edit) return;
    await runPending(pendingGate, setBusy, `edit-${edit.id}`, async () => {
      const parsed = parseChargeAmount(edit.amount);
      if (parsed == null) {
        setError("Enter a positive amount.");
        return;
      }
      if (admin && edit.paid) {
        const ok = window.confirm("This charge is already marked paid. Save the change anyway?");
        if (!ok) return;
      }
      setError("");
      const { error: rpcError } = await supabase.rpc("edit_charge", {
        p_id: edit.id,
        p_amount: parsed,
        p_site: edit.siteId || null,
        p_note: edit.note,
        p_receipt_url: normalizeReceiptUrl(edit.receipt),
        p_key: crypto.randomUUID(),
      });
      if (rpcError) {
        setError(turnedOff(rpcError, "edit_charge") ? NOT_TURNED_ON : rpcError.message);
        return;
      }
      setEdit(null);
      await queryClient.invalidateQueries({ queryKey: ["charges"] });
    });
  }

  function renderRow(row: ChargeRow, showPaidActions: boolean) {
    const siteName = row.site_id ? modeSites.find((site) => site.id === row.site_id)?.short_name : null;
    const access = chargeEditAccess({
      charge: row,
      viewerPersonId: profile?.id,
      isAdmin: admin,
    });
    const locked = chargeEditLockedLabel(access.reason);
    return (
      <div key={row.id} className="rounded-2xl bg-stone-50 px-3 py-3">
        <p className="font-semibold">{money(row.amount)} · {personName(row.person_id)}</p>
        <p className="text-sm text-stone-600">
          {row.note || "No note"}
          {siteName ? ` · ${siteName}` : ""}
        </p>
        <p className="text-xs text-stone-500">
          Logged {formatWhen(row.created_at ?? null)}
          {row.edited_at ? ` · edited ${formatWhen(row.edited_at)}` : ""}
        </p>
        {row.receipt_url ? (
          <a className="text-sm font-semibold text-[var(--accent)]" href={row.receipt_url} target="_blank" rel="noreferrer">
            Receipt
          </a>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {access.canEdit ? (
            <Button tone="quiet" disabled={Boolean(busy)} onClick={() => openEdit(row)}>
              Edit
            </Button>
          ) : locked ? (
            <p className="text-sm font-medium text-stone-600">{locked}</p>
          ) : null}
          {admin && showPaidActions && !row.paid ? (
            <Button tone="quiet" disabled={Boolean(busy)} onClick={() => void markPaid(row, true)}>
              {busy === `paid-${row.id}` ? "Saving…" : "Mark paid"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const body = (
    <>
      {embedded || !admin ? null : <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>}
      <Title sub="Log a purchase for reimbursement. No email is sent.">Labour & reimbursements</Title>
      <p className="mb-3 text-sm text-stone-600">
        Hours from completed visits stay on <Link className="font-semibold text-[var(--accent)]" to={admin ? "/admin/payroll" : "/pay"}>{admin ? "Payroll" : "Your pay"}</Link>.
        You can fix your own charge until midnight Toronto time on the day you logged it. After that, ask an admin.
      </p>
      {edit ? (
        <Card className="mb-4">
          <h2 className="font-semibold">Edit charge</h2>
          {edit.paid && admin ? (
            <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              This charge is already marked paid. Saving will change a paid record.
            </p>
          ) : null}
          <Field label="Amount">
            <input
              className={inputClass}
              inputMode="decimal"
              value={edit.amount}
              onChange={(event) => setEdit({ ...edit, amount: event.target.value })}
            />
          </Field>
          <Field label="Site (optional)">
            <select className={inputClass} value={edit.siteId} onChange={(event) => setEdit({ ...edit, siteId: event.target.value })}>
              <option value="">None</option>
              {modeSites.map((site) => (
                <option key={site.id} value={site.id}>{site.short_name}</option>
              ))}
            </select>
          </Field>
          <Field label="What for">
            <input className={inputClass} value={edit.note} onChange={(event) => setEdit({ ...edit, note: event.target.value })} />
          </Field>
          {edit.receipt ? (
            <p className="mb-3 text-sm">
              <a className="font-semibold text-[var(--accent)]" href={edit.receipt} target="_blank" rel="noreferrer">Receipt</a>
            </p>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button tone="quiet" disabled={Boolean(busy)} onClick={() => setEdit(null)}>Cancel</Button>
            <Button disabled={Boolean(busy)} onClick={() => void saveEdit()}>
              {busy === `edit-${edit.id}` ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Card>
      ) : null}
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
        <Button disabled={Boolean(busy)} onClick={() => void add()}>{busy === "add" ? "Saving…" : "Save charge"}</Button>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">Unpaid</h2>
        <div className="mt-3 grid gap-3">
          {unpaid.length === 0 ? <p className="text-sm text-stone-500">Nothing unpaid.</p> : null}
          {unpaid.map((row) => renderRow(row, true))}
        </div>
      </Card>
      {admin ? (
        <Card className="mt-4">
          <h2 className="font-semibold">Recently paid</h2>
          <div className="mt-3 grid gap-3">
            {(charges.data ?? [])
              .filter((row) => row.paid && !row.voided)
              .slice(0, 8)
              .map((row) => (
                <div key={row.id}>
                  {renderRow(row, false)}
                  <Button
                    tone="quiet"
                    className="mt-2 min-h-10 px-3 text-sm"
                    disabled={Boolean(busy)}
                    onClick={() => void markPaid(row, false)}
                  >
                    Undo paid
                  </Button>
                </div>
              ))}
          </div>
        </Card>
      ) : (
        <Card className="mt-4">
          <h2 className="font-semibold">Your recent charges</h2>
          <div className="mt-3 grid gap-3">
            {(charges.data ?? [])
              .filter((row) => row.paid || row.voided)
              .slice(0, 8)
              .map((row) => renderRow(row, false))}
            {(charges.data ?? []).filter((row) => row.paid || row.voided).length === 0 ? (
              <p className="text-sm text-stone-500">No paid charges yet.</p>
            ) : null}
          </div>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
    </>
  );
  if (embedded) return body;
  return <Screen>{body}</Screen>;
}
