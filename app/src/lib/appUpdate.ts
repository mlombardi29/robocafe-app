import type { FlushResult } from "./sync";

export const UI_BUILD = "ui-2026-11-05-sw-prompt";

export type PromptState = {
  available: boolean;
  expanded: boolean;
  warning: string | null;
};

export const hiddenPrompt: PromptState = { available: false, expanded: false, warning: null };

/** A first install has no previous controller. Only a later controller change is an update. */
export function shouldPromptAfterControllerChange(hadControllerBeforeChange: boolean): boolean {
  return hadControllerBeforeChange;
}

export type PromptResult = PromptState & { reload: boolean; clearStorage: false };

export function reducePrompt(
  state: PromptState,
  action: "available" | "later" | "blocked" | "reload-ok",
  warning?: string,
): PromptResult {
  if (action === "available") {
    return { available: true, expanded: true, warning: null, reload: false, clearStorage: false };
  }
  if (action === "later") {
    return { available: true, expanded: false, warning: null, reload: false, clearStorage: false };
  }
  if (action === "blocked") {
    return {
      available: true,
      expanded: true,
      warning: warning ?? "Unsynced work is still on this phone. Stay here until it syncs, then reload.",
      reload: false,
      clearStorage: false,
    };
  }
  return { ...state, expanded: false, warning: null, reload: true, clearStorage: false };
}

const UNSYNCED = "Unsynced work is still on this phone. Stay here until it syncs, then reload. Nothing was erased.";

export async function prepareReload(deps: {
  flush: () => Promise<Pick<FlushResult, "ok" | "retry">>;
  readQueue: () => Promise<unknown[]>;
}): Promise<{ reload: boolean; clearStorage: false; warning: string | null }> {
  const flushed = await deps.flush();
  const queue = await deps.readQueue();
  if ((!flushed.ok && flushed.retry) || queue.length > 0) {
    return { reload: false, clearStorage: false, warning: UNSYNCED };
  }
  return { reload: true, clearStorage: false, warning: null };
}
