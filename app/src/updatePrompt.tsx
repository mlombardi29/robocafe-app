import { useEffect, useState } from "react";
import { UI_BUILD, prepareReload, reducePrompt, type PromptState } from "./lib/appUpdate";
import { flushQueue, readQueue } from "./lib/sync";
import { startUpdateWatch } from "./swWatch";

export function UpdatePrompt() {
  const [state, setState] = useState<PromptState>({ available: false, expanded: false, warning: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => startUpdateWatch(() => setState((current) => reducePrompt(current, "available"))), []);

  async function reload() {
    setBusy(true);
    try {
      const decision = await prepareReload({ flush: flushQueue, readQueue });
      if (!decision.reload) {
        setState((current) => reducePrompt(current, "blocked", decision.warning ?? undefined));
        return;
      }
      window.location.reload();
    } catch {
      setState((current) =>
        reducePrompt(current, "blocked", "Could not check unsynced work. Stay on this page and try Reload again."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!state.available) return <span className="sr-only" data-ui-build={UI_BUILD} />;

  if (!state.expanded) {
    return (
      <div className="fixed inset-x-0 top-0 z-40 mx-auto flex w-full max-w-[480px] justify-end px-3 pt-2">
        <button
          type="button"
          className="min-h-12 rounded-2xl bg-stone-900 px-4 text-sm font-semibold text-white"
          onClick={() => setState((current) => reducePrompt(current, "available"))}
        >
          Update ready
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[480px] px-3 pt-2" role="dialog" aria-labelledby="update-title" data-ui-build={UI_BUILD}>
      <div className="rounded-2xl bg-stone-900 p-4 text-white shadow-lg">
        <p id="update-title" className="text-base font-semibold">An update is ready</p>
        <p className="mt-1 text-sm text-stone-200">Reload when you are between steps. Your sign-in and unsynced work stay on this phone.</p>
        {state.warning ? <p className="mt-2 text-sm font-medium text-amber-200">{state.warning}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="min-h-12 rounded-2xl bg-white px-3 text-base font-semibold text-stone-900" disabled={busy} onClick={() => void reload()}>
            {busy ? "Checking" : "Reload"}
          </button>
          <button type="button" className="min-h-12 rounded-2xl bg-stone-700 px-3 text-base font-semibold text-white" disabled={busy} onClick={() => setState((current) => reducePrompt(current, "later"))}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
