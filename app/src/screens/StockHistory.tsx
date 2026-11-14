import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { loadSites } from "../data";
import { inPractice } from "../lib/access";
import { formatWhen } from "../lib/dates";
import { turnedOff } from "../lib/rpcError";
import { formatDelta, placeLabel, txTypeLabel, type StockTxRow } from "../lib/stockHistory";
import { supabase } from "../lib/supabase";
import { Card, ErrorText, Screen, Title } from "../ui";

type SkuLite = { id: string; name: string; base_unit: string | null };
type PersonLite = { id: string; goes_by: string };

export function StockHistoryPage() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  const admin = profile?.role === "admin";

  const query = useQuery({
    queryKey: ["stock-history", practice],
    queryFn: async () => {
      const [txs, skus, people, sites] = await Promise.all([
        supabase
          .from("inventory_tx")
          .select("id, created_at, type, delta_base, note, location, site_id, sku_id, person_id, is_sandbox")
          .eq("is_sandbox", practice)
          .order("created_at", { ascending: false })
          .limit(120),
        supabase.from("skus").select("id, name, base_unit"),
        supabase.from("people").select("id, goes_by"),
        loadSites(),
      ]);
      if (txs.error) {
        if (turnedOff(txs.error, "inventory_tx") || turnedOff(txs.error, "schema cache")) {
          return { missing: true as const, rows: [] as StockTxRow[], skus: [] as SkuLite[], people: [] as PersonLite[], sites: [] as Awaited<ReturnType<typeof loadSites>> };
        }
        throw new Error(txs.error.message);
      }
      if (skus.error) throw new Error(skus.error.message);
      if (people.error) throw new Error(people.error.message);
      return {
        missing: false as const,
        rows: (txs.data ?? []) as StockTxRow[],
        skus: (skus.data ?? []) as SkuLite[],
        people: (people.data ?? []) as PersonLite[],
        sites,
      };
    },
  });

  const skuById = new Map((query.data?.skus ?? []).map((row) => [row.id, row]));
  const personById = new Map((query.data?.people ?? []).map((row) => [row.id, row.goes_by]));
  const siteById = new Map((query.data?.sites ?? []).map((row) => [row.id, row.short_name]));

  return (
    <Screen>
      <Link to={admin ? "/admin" : "/inventory"} className="text-sm font-semibold text-[var(--accent)]">
        {admin ? "Admin" : "Stock"}
      </Link>
      <Title sub="Adds, takes, and recounts. Newest first.">Stock history</Title>
      {query.data?.missing ? (
        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Stock history is not available on this database yet.</p>
      ) : null}
      <div className="mt-4 grid gap-3">
        {(query.data?.rows ?? []).map((row) => {
          const sku = skuById.get(row.sku_id);
          return (
            <Card key={row.id}>
              <p className="font-semibold">{sku?.name ?? "Item"}</p>
              <p className="text-sm text-stone-600">
                {txTypeLabel(row.type)} · {formatDelta(Number(row.delta_base), sku?.base_unit ?? null)} · {placeLabel(row.location, row.site_id ? siteById.get(row.site_id) ?? null : null)}
              </p>
              <p className="text-sm text-stone-500">
                {formatWhen(row.created_at)}
                {row.person_id && personById.get(row.person_id) ? ` · ${personById.get(row.person_id)}` : ""}
              </p>
              {row.note ? <p className="mt-1 text-sm text-stone-700">{row.note}</p> : null}
            </Card>
          );
        })}
        {query.isLoading ? <p className="text-stone-600">Loading…</p> : null}
        {query.error ? <ErrorText>{query.error instanceof Error ? query.error.message : "Could not load history."}</ErrorText> : null}
        {!query.isLoading && !query.data?.missing && (query.data?.rows ?? []).length === 0 ? (
          <p className="text-stone-600">No stock moves yet.</p>
        ) : null}
      </div>
    </Screen>
  );
}
