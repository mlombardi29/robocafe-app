import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto min-h-screen w-full max-w-[480px] px-4 pb-36 pt-4 ${className}`}>{children}</div>;
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

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "quiet" | "danger" };

export function Button({ tone = "primary", className = "", ...props }: ButtonProps) {
  const tones = {
    primary: "bg-[var(--accent)] text-white",
    quiet: "bg-white text-stone-800 ring-1 ring-stone-200",
    danger: "bg-red-700 text-white",
  };
  return (
    <button
      type="button"
      className={`min-h-12 rounded-2xl px-4 text-base font-semibold disabled:opacity-50 ${tones[tone]} ${className}`}
      {...props}
    />
  );
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
  state,
  note,
  onDone,
  onSkip,
  onNote,
  disabled,
}: {
  title: string;
  detail: string | null;
  howTo?: string | null;
  placeholder: string | null;
  overdue?: boolean;
  due?: boolean;
  locked?: boolean;
  state?: string | null;
  note?: string;
  onDone?: () => void;
  onSkip?: () => void;
  onNote?: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`rounded-3xl bg-white p-4 shadow-sm ring-1 ${overdue ? "ring-red-300" : "ring-black/5"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold leading-snug">{title}</h3>
        {overdue ? <span className="shrink-0 rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-800">Overdue</span> : null}
        {!overdue && due === false ? <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-600">Not due</span> : null}
      </div>
      {placeholder ? (
        <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          Criteria pending. {placeholder}
        </p>
      ) : null}
      {detail ? <p className="mt-2 text-sm text-stone-700">{detail}</p> : null}
      {howTo ? (
        <details className="mt-2">
          <summary className="min-h-12 cursor-pointer py-2 text-sm font-semibold text-[var(--accent)]">Details</summary>
          <p className="pb-2 text-sm leading-relaxed text-stone-700">{howTo}</p>
        </details>
      ) : null}
      {locked ? <p className="mt-2 text-sm font-medium text-stone-500">Locked while milk cleaning runs.</p> : null}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone={state === "done" ? "primary" : "quiet"} disabled={disabled || locked} onClick={onDone}>
          Done
        </Button>
        <Button tone={state === "not_needed" ? "primary" : "quiet"} disabled={disabled || locked} onClick={onSkip}>
          Not needed
        </Button>
      </div>
      <button type="button" className="mt-3 min-h-12 text-sm font-semibold text-[var(--accent)]" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide note" : "Note"}
      </button>
      {open ? (
        <textarea
          className={`${inputClass} mt-2 min-h-24 py-3`}
          value={note ?? ""}
          disabled={disabled || locked}
          onChange={(event) => onNote?.(event.target.value)}
        />
      ) : null}
    </article>
  );
}
