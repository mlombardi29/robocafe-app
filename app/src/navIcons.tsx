export type TabIcon = "today" | "stock" | "schedule" | "learn" | "pay";

export function TabGlyph({ name }: { name: TabIcon }) {
  const common = { className: "h-6 w-6", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true as const };
  if (name === "today") {
    return <svg {...common}><path strokeLinejoin="round" d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
  }
  if (name === "stock") {
    return <svg {...common}><path strokeLinejoin="round" d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></svg>;
  }
  if (name === "schedule") {
    return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
  }
  if (name === "learn") {
    return <svg {...common}><path d="M4 6.5 12 4l8 2.5V18l-8 2.5L4 18z" /><path d="M12 6.5V20.5" /></svg>;
  }
  return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
}

const TABS: { icon: TabIcon; label: string }[] = [
  { icon: "today", label: "Today" },
  { icon: "stock", label: "Stock" },
  { icon: "schedule", label: "Schedule" },
  { icon: "learn", label: "Learn" },
  { icon: "pay", label: "Pay" },
];

/** Static copy of the signed-in tab bar, for the dev preview only. */
export function PreviewTabs({ active, admin = false }: { active: string; admin?: boolean }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-white" aria-label="Main">
      {admin ? <span className="mx-auto flex min-h-12 max-w-[480px] items-center justify-center border-b border-black/5 text-base font-semibold text-[var(--accent)]">Admin</span> : null}
      <div className="mx-auto grid max-w-[480px] grid-cols-5">
        {TABS.map((tab) => {
          const on = tab.label === active;
          return (
            <span
              key={tab.label}
              className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold leading-tight ${on ? "text-[var(--accent)] shadow-[inset_0_3px_0_0_var(--accent)]" : "text-stone-600"}`}
            >
              <TabGlyph name={tab.icon} />
              <span>{tab.label}</span>
            </span>
          );
        })}
      </div>
    </nav>
  );
}
