import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SYNTHETIC_CATALOGUE, previewCatalogue } from "../lib/cataloguePreview";
import { NOT_TURNED_ON, turnedOff } from "../lib/rpcError";
import { supabase } from "../lib/supabase";
import { Button, Card, ErrorText, Screen, Title } from "../ui";

export function ImportPreviewPage() {
  const [csv, setCsv] = useState(SYNTHETIC_CATALOGUE);
  const [shown, setShown] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const preview = useMemo(() => previewCatalogue(csv), [csv]);
  async function previewNotice(kind: "pickup" | "reorder") {
    setError("");
    const { data, error: rpcError } = await supabase.rpc("preview_ops_notification", {
      p_kind: kind,
      p_key: crypto.randomUUID(),
      p_request_send: true,
    });
    if (rpcError) {
      setNotice("");
      setError(turnedOff(rpcError, "preview_ops_notification") ? NOT_TURNED_ON : rpcError.message);
      return;
    }
    const row = data as { sent?: boolean; status?: string; recipient_count?: number };
    setNotice(`${kind} preview: sent ${String(row.sent)} · ${row.status} · ${row.recipient_count ?? 0} recipients. Nothing was emailed.`);
  }
  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Preview only. Nothing is written to stock, sites, or KC Manager.">Catalogue preview</Title>
      <textarea className="min-h-40 w-full rounded-2xl border border-stone-200 p-3 text-sm" value={csv} onChange={(event) => { setCsv(event.target.value); setShown(false); }} />
      <Button className="mt-3" onClick={() => setShown(true)}>Preview</Button>
      <div className="mt-3 grid gap-2">
        <Button onClick={() => void previewNotice("reorder")}>Preview reorder notice</Button>
        <Button onClick={() => void previewNotice("pickup")}>Preview pickup notice</Button>
        <p className="text-sm text-stone-600">Both ask to send. The server keeps them disabled. Pickup has no assigned next tech, so no recipient is guessed.</p>
        {notice ? <p className="text-sm font-medium">{notice}</p> : null}
        <ErrorText>{error}</ErrorText>
      </div>
      {shown ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm text-stone-600">{preview.activeCount} active rows. {preview.issues.length} discrepancies. Writes: {preview.writes}.</p>
          {preview.issues.map((issue) => (
            <Card key={`${issue.legacyId}-${issue.code}`}>
              <p className="font-semibold">{issue.name}</p>
              <p className="text-sm text-stone-700">{issue.detail}</p>
            </Card>
          ))}
          {preview.proposals.map((row) => (
            <Card key={row.legacyId}>
              <p className="font-semibold">{row.name}</p>
              <p className="text-sm text-stone-600">
                {row.rawBaseUnit} → {row.proposedBaseUnit}
                {row.conversionFactor ? ` × ${row.conversionFactor} (not applied)` : ""}
              </p>
              <p className="text-sm text-stone-600">
                Historical sum {row.derivedRaw ?? "not read"}
                {row.derivedProposed != null ? ` · proposed ${row.derivedProposed}` : ""}
                . KC max: not set.
              </p>
            </Card>
          ))}
        </div>
      ) : null}
    </Screen>
  );
}
