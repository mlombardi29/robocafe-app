import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { loadSites } from "../data";
import { CONFIG_KEY_SPECS, isEditableConfigKey } from "../lib/configKeys";
import { createPendingGate, runPending } from "../lib/pendingAction";
import { turnedOff } from "../lib/rpcError";
import { DUPONT_ESPRESSO_FLOAT_KEY, espressoFloatLevels } from "../lib/stockRules";
import { supabase } from "../lib/supabase";
import type { SiteRow } from "../lib/types";
import { Button, Card, ErrorText, Field, Screen, Title, inputClass } from "../ui";

type ConfigRow = { key: string; value: string };

function timeInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [siteDrafts, setSiteDrafts] = useState<Record<string, { opening: string; closing: string; before: string; after: string }>>({});
  const pendingGate = useRef(createPendingGate()).current;

  const config = useQuery({
    queryKey: ["admin-config"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase.from("config").select("key, value");
      if (queryError) {
        if (turnedOff(queryError, "config") || turnedOff(queryError, "schema cache")) return [] as ConfigRow[];
        throw new Error(queryError.message);
      }
      return (data ?? []) as ConfigRow[];
    },
  });

  const sites = useQuery({
    queryKey: ["admin-site-hours"],
    queryFn: async () => (await loadSites()).filter((site) => !site.is_sandbox),
  });

  function draftFor(key: string, current: string): string {
    return drafts[key] ?? current;
  }

  function siteDraft(site: SiteRow) {
    return (
      siteDrafts[site.id] ?? {
        opening: timeInputValue(site.opening_time),
        closing: timeInputValue(site.closing_time),
        before: timeInputValue(site.soft_prefer_before),
        after: timeInputValue(site.soft_prefer_after),
      }
    );
  }

  async function saveConfig(key: string, value: string) {
    if (!isEditableConfigKey(key)) return;
    setError("");
    setMessage("");
    await runPending(pendingGate, setBusy, `cfg-${key}`, async () => {
      if (key === DUPONT_ESPRESSO_FLOAT_KEY) {
        const floatBags = Number(value);
        if (!Number.isFinite(floatBags) || floatBags < 1) {
          setError("Dupont espresso float must be at least 1 bag.");
          return;
        }
        const levels = espressoFloatLevels(floatBags);
        const { error: upsertError } = await supabase.from("config").upsert({ key, value: String(levels.target) });
        if (upsertError) {
          setError(upsertError.message);
          return;
        }
        const { error: skuError } = await supabase
          .from("skus")
          .update({ reorder_threshold: levels.reorderBelow, target_level: levels.target })
          .in("legacy_id", ["espresso-beans", "espresso-beans:practice"]);
        if (skuError && !/target_level|schema cache|does not exist/i.test(skuError.message)) {
          setError(skuError.message);
          return;
        }
        setMessage(`Saved Dupont float ${levels.target} bags (reorder below ${levels.reorderBelow}).`);
        await queryClient.invalidateQueries({ queryKey: ["admin-config"] });
        await queryClient.invalidateQueries({ queryKey: ["skus"] });
        return;
      }
      const { error: upsertError } = await supabase.from("config").upsert({ key, value });
      if (upsertError) {
        setError(upsertError.message);
        return;
      }
      setMessage("Saved.");
      await queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    });
  }

  async function saveSiteHours(site: SiteRow) {
    const draft = siteDraft(site);
    setError("");
    setMessage("");
    await runPending(pendingGate, setBusy, `site-${site.id}`, async () => {
      const payload = {
        opening_time: draft.opening || null,
        closing_time: draft.closing || null,
        soft_prefer_before: draft.before || null,
        soft_prefer_after: draft.after || null,
      };
      const { error: updateError } = await supabase.from("sites").update(payload).eq("id", site.id);
      if (updateError) {
        const missing = /closing_time|soft_prefer_before|soft_prefer_after|schema cache|does not exist/i.test(updateError.message);
        setError(missing ? "Site hours need the next database update (0017) before they can be saved." : updateError.message);
        return;
      }
      setMessage(`Saved hours for ${site.short_name}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin-site-hours"] });
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
    });
  }

  const byKey = new Map((config.data ?? []).map((row) => [row.key, row.value]));

  return (
    <Screen>
      <Link to="/admin" className="text-sm font-semibold text-[var(--accent)]">Admin</Link>
      <Title sub="Safe settings only. Soft lunch windows never block a visit.">Settings</Title>
      {message ? <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{message}</p> : null}
      <ErrorText>{error}</ErrorText>

      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-stone-500">Site hours</h2>
      <div className="grid gap-3">
        {(sites.data ?? []).map((site) => {
          const draft = siteDraft(site);
          return (
            <Card key={site.id}>
              <p className="font-semibold">{site.short_name}</p>
              <p className="text-sm text-stone-600">Open hours and soft preferred service window (blank = none).</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Opens">
                  <input
                    type="time"
                    className={inputClass}
                    value={draft.opening}
                    onChange={(event) =>
                      setSiteDrafts((prev) => ({ ...prev, [site.id]: { ...draft, opening: event.target.value } }))
                    }
                  />
                </Field>
                <Field label="Closes">
                  <input
                    type="time"
                    className={inputClass}
                    value={draft.closing}
                    onChange={(event) =>
                      setSiteDrafts((prev) => ({ ...prev, [site.id]: { ...draft, closing: event.target.value } }))
                    }
                  />
                </Field>
                <Field label="Best before">
                  <input
                    type="time"
                    className={inputClass}
                    value={draft.before}
                    onChange={(event) =>
                      setSiteDrafts((prev) => ({ ...prev, [site.id]: { ...draft, before: event.target.value } }))
                    }
                  />
                </Field>
                <Field label="Or after">
                  <input
                    type="time"
                    className={inputClass}
                    value={draft.after}
                    onChange={(event) =>
                      setSiteDrafts((prev) => ({ ...prev, [site.id]: { ...draft, after: event.target.value } }))
                    }
                  />
                </Field>
              </div>
              <Button className="mt-3" disabled={Boolean(busy)} onClick={() => void saveSiteHours(site)}>
                {busy === `site-${site.id}` ? "Saving…" : "Save hours"}
              </Button>
            </Card>
          );
        })}
        {sites.isLoading ? <p className="text-stone-600">Loading sites…</p> : null}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-stone-500">App config</h2>
      <div className="grid gap-3">
        {CONFIG_KEY_SPECS.map((spec) => {
          const current = byKey.get(spec.key) ?? "";
          const value = draftFor(spec.key, current);
          return (
            <Card key={spec.key}>
              <p className="font-semibold">{spec.label}</p>
              <p className="text-sm text-stone-600">{spec.help}</p>
              {spec.editable ? (
                <>
                  <Field label="Value">
                    <input
                      className={inputClass}
                      value={value}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [spec.key]: event.target.value }))}
                    />
                  </Field>
                  <Button className="mt-2" disabled={Boolean(busy)} onClick={() => void saveConfig(spec.key, value)}>
                    {busy === `cfg-${spec.key}` ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                <p className="mt-2 rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700">{current || "—"}</p>
              )}
            </Card>
          );
        })}
      </div>
    </Screen>
  );
}
