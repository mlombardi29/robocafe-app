import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { composeButtonClass, type ButtonTone } from "./lib/buttonStyles";
import { actionButtonClass, actionRowClass, disclosureClass, noteFieldClass, stepCardClass } from "./lib/checklistLayout";

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto min-h-screen w-full max-w-[480px] px-4 pb-[calc(var(--nav-stack)+11rem)] pt-4 ${className}`}>{children}</div>;
}

export function PracticeBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-4 rounded-2xl bg-orange-700 px-4 py-3 text-center text-sm font-bold tracking-wide text-white">
      PRACTICE — not real
    </div>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-3xl font-semibold tracking-tight">{children}</h1>
      {sub ? <p className="mt-1 text-base text-stone-600">{sub}</p> : null}
    </header>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone };

export function Button({ tone = "primary", className = "", ...props }: ButtonProps) {
  return <button type="button" className={composeButtonClass(tone, className)} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 ${className}`}>{children}</section>;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-2xl border border-stone-200 bg-white px-4 text-base outline-none focus:border-[var(--accent)]";

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-3 text-sm font-medium text-red-700">{children}</p>;
}

export function PinPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div>
      <div className="mb-4 flex h-8 justify-center gap-2" aria-live="polite">
        {Array.from({ length: Math.max(value.length, 4) }).map((_, index) => (
          <span
            key={index}
            className={`h-3 w-3 rounded-full ${index < value.length ? "bg-stone-800" : "bg-stone-300"}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {keys.map((key) =>
          key === "" ? (
            <span key="gap" />
          ) : (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-label={key === "del" ? "Delete" : key}
              className="min-h-[4.25rem] rounded-2xl bg-white text-2xl font-semibold shadow-sm ring-1 ring-black/5 disabled:opacity-40"
              onClick={() => {
                if (key === "del") onChange(value.slice(0, -1));
                else if (value.length < 6) onChange(value + key);
              }}
            >
              {key === "del" ? "⌫" : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function CheckItem({
  title,
  detail,
  howTo,
  placeholder,
  overdue,
  due,
  locked,
  doneLocked,
  skipLocked,
  lockMessage,
  state,
  note,
  onDone,
  onSkip,
  onNote,
  disabled,
  stepId,
  highlighted,
  initialNoteOpen = false,
  initialDetailsOpen = false,
}: {
  title: string;
  detail: string | null;
  howTo?: string | null;
  placeholder: string | null;
  overdue?: boolean;
  due?: boolean;
  locked?: boolean;
  doneLocked?: boolean;
  skipLocked?: boolean;
  lockMessage?: string | null;
  state?: string | null;
  note?: string;
  onDone?: () => void;
  onSkip?: () => void;
  onNote?: (value: string) => void;
  disabled?: boolean;
  stepId?: string;
  highlighted?: boolean;
  initialNoteOpen?: boolean;
  initialDetailsOpen?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(initialNoteOpen);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const noteId = stepId ? `${stepId}-note` : undefined;
  const detailsId = stepId ? `${stepId}-details` : undefined;
  const doneSelected = state === "done";
  const skipSelected = state === "not_needed";
  const savedNote = Boolean(note?.trim());
  const blockDone = Boolean(doneLocked || locked);
  const blockSkip = Boolean(skipLocked || locked);
  const lockText = lockMessage ?? (blockDone || blockSkip ? "Locked while milk cleaning runs." : null);
  return (
    <article id={stepId} tabIndex={-1} className={stepCardClass(Boolean(highlighted), Boolean(overdue))}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold leading-snug">{title}</h3>
        {overdue ? <span className="mt-0.5 shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">Overdue</span> : null}
        {!overdue && due === false ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">Not due</span>
        ) : null}
      </div>
      {placeholder ? (
        <p className="mt-1 rounded-xl bg-amber-50 px-2.5 py-1.5 text-sm font-medium leading-snug text-amber-950">
          Criteria pending. {placeholder}
        </p>
      ) : null}
      {detail ? <p className="mt-1 text-sm leading-snug text-stone-700">{detail}</p> : null}
      {lockText ? <p className="mt-1 text-sm font-medium text-stone-500">{lockText}</p> : null}
      <div className={actionRowClass}>
        <Button
          tone={doneSelected ? "primary" : "quiet"}
          className={actionButtonClass}
          disabled={disabled || blockDone}
          aria-pressed={doneSelected}
          onClick={onDone}
        >
          Done
        </Button>
        <Button
          tone={skipSelected ? "primary" : "quiet"}
          className={actionButtonClass}
          disabled={disabled || blockSkip}
          aria-pressed={skipSelected}
          onClick={onSkip}
        >
          Not needed
        </Button>
        <button
          type="button"
          className={disclosureClass}
          aria-expanded={noteOpen}
          aria-controls={noteId}
          aria-label={noteOpen ? "Hide note" : savedNote ? "Note, saved" : "Note"}
          onClick={() => setNoteOpen((value) => !value)}
        >
          {noteOpen ? "Hide note" : "Note"}
          {!noteOpen && savedNote ? <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" /> : null}
        </button>
        {howTo ? (
          <button
            type="button"
            className={disclosureClass}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>
      {noteOpen ? (
        <textarea
          id={noteId}
          rows={2}
          className={noteFieldClass}
          aria-label={`Note for ${title}`}
          value={note ?? ""}
          disabled={disabled || blockDone || blockSkip}
          onChange={(event) => onNote?.(event.target.value)}
        />
      ) : null}
      {detailsOpen && howTo ? (
        <p id={detailsId} className="mt-1 text-sm leading-relaxed text-stone-700">
          {howTo}
        </p>
      ) : null}
    </article>
  );
}

export function FreshPracticeDialog({
  error,
  busy,
  onClose,
  onConfirm,
}: {
  error: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="fresh-practice-title">
      <div className="mx-auto w-full max-w-[480px] rounded-3xl bg-white p-4">
        <h2 id="fresh-practice-title" className="text-xl font-semibold">Start a fresh practice visit?</h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          The current practice attempt is kept. A new empty visit starts, with no ticks and a new milk timer. Live visits are not changed.
        </p>
        {error ? (
          <p className="mt-3 text-sm font-medium text-red-700" role="alert">{error}</p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button tone="quiet" disabled={busy} onClick={onClose}>Go back</Button>
          <Button disabled={busy} onClick={onConfirm}>{busy ? "Starting…" : "Start fresh"}</Button>
        </div>
      </div>
    </div>
  );
}

export function MilkStepCard({
  stepId,
  highlighted,
  title,
  details,
  minutes,
  started,
  countedDone,
  notNeeded,
  startDisabled,
  skipDisabled,
  guidance,
  onStart,
  onSkip,
  initialDetailsOpen = false,
}: {
  stepId?: string;
  highlighted?: boolean;
  title: string;
  details?: string | null;
  minutes: number;
  started: boolean;
  countedDone: boolean;
  notNeeded: boolean;
  startDisabled?: boolean;
  skipDisabled?: boolean;
  guidance?: string | null;
  onStart?: () => void;
  onSkip?: () => void;
  initialDetailsOpen?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const detailsId = stepId ? `${stepId}-details` : undefined;
  return (
    <div id={stepId} tabIndex={-1} className={stepCardClass(Boolean(highlighted))}>
      <h3 className="text-lg font-semibold leading-snug">{title}</h3>
      <p className="mt-1 text-sm leading-snug text-stone-500">About {minutes} minutes. The timer starts when you tap Start, and it stays if you leave this page.</p>
      {guidance ? <p className="mt-1 text-sm leading-snug text-stone-600">{guidance}</p> : null}
      {countedDone ? <p className="mt-1 text-sm font-medium text-emerald-800">Counted as done because cleaning already started.</p> : null}
      <div className={actionRowClass}>
        <Button className="min-w-[12rem] flex-[1.6] !px-3" disabled={startDisabled} aria-pressed={started} onClick={onStart}>
          {started ? "Cleaning started" : "Start milk cleaning"}
        </Button>
        <Button
          tone={notNeeded ? "primary" : "quiet"}
          className={actionButtonClass}
          disabled={skipDisabled}
          aria-pressed={notNeeded}
          onClick={onSkip}
        >
          Not needed
        </Button>
        {details ? (
          <button
            type="button"
            className={disclosureClass}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((value) => !value)}
          >
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        ) : null}
      </div>
      {detailsOpen && details ? (
        <p id={detailsId} className="mt-1 text-sm leading-relaxed text-stone-700">
          {details}
        </p>
      ) : null}
    </div>
  );
}
