/** Prevent double-submit while an async write is in flight. */

export type PendingGate = { current: string };

export function createPendingGate(): PendingGate {
  return { current: "" };
}

export async function runPending(
  gate: PendingGate,
  setBusy: (next: string) => void,
  key: string,
  work: () => Promise<void>,
): Promise<void> {
  if (gate.current) return;
  gate.current = key;
  setBusy(key);
  try {
    await work();
  } finally {
    gate.current = "";
    setBusy("");
  }
}
