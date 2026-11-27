import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AddPersonPage } from "../screens/Admin";
import type { SiteRow } from "../lib/types";
import { composeButtonClass } from "../lib/buttonStyles";
import { CLOCK_OUT_SAVED, SUCCESS_TOAST_MS, successToast, visibleEndNotice, type EndNotice } from "../lib/serviceFlow";
import { FRESH_OFFLINE, assessFreshStart } from "../lib/freshPractice";
import { MILK_LOCK_NOT_NEEDED_OK } from "../lib/milkLock";
import { correctionGlance } from "../lib/correctionGlance";
import { CorrectionGlanceView } from "../screens/CorrectionGlance";
import { TodayView } from "../screens/Home";
import { PayPeriodDetailView } from "../screens/Payroll";
import { LowOutListView, ReorderBanner, StockGlanceView, WarehouseListView } from "../screens/stockViews";
import { toWarehouseRow } from "../lib/stockGlance";
import { PreviewTabs } from "../navIcons";
import { Button, Card, CheckItem, Field, FreshPracticeDialog, MilkStepCard, PinPad, PracticeBanner, Screen, Title, inputClass } from "../ui";

const sites: SiteRow[] = [
  {
    id: "sinai",
    name: "Mount Sinai Hospital",
    short_name: "Sinai",
    model_id: "s35",
    serial: null,
    cadence: "daily",
    opening_time: null,
    active: true,
    is_sandbox: false,
    models: null,
  },
  {
    id: "uoft",
    name: "UofT Sidney Smith",
    short_name: "UofT",
    model_id: "s22",
    serial: null,
    cadence: "mwf",
    opening_time: "10:00",
    closing_time: "17:30",
    soft_prefer_before: "11:00",
    soft_prefer_after: "15:00",
    active: true,
    is_sandbox: false,
    models: null,
  },
];

export default function PreviewApp() {
  const { screen = "login" } = useParams();
  useEffect(() => {
    document.documentElement.dataset.mode = screen === "checklist" || screen === "checklist-open" || screen === "training" ? "practice" : "live";
  }, [screen]);

  if (screen === "login") {
    return (
      <Screen>
        <Title sub="Tap your name.">KioskOps</Title>
        <div className="grid gap-3">
          {["Michael", "Kajsa"].map((name) => (
            <button key={name} type="button" className="min-h-12 rounded-2xl bg-white px-4 text-left text-lg font-semibold ring-1 ring-stone-200">
              {name}
            </button>
          ))}
        </div>
      </Screen>
    );
  }

  if (screen === "pin") {
    return (
      <Screen>
        <Title sub="Hi Michael. Enter your PIN.">KioskOps</Title>
        <PinPad value="4821" onChange={() => undefined} />
      </Screen>
    );
  }

  if (screen === "toast") return <ToastPreview />;
  if (screen === "correction") return <CorrectionPreview />;
  if (screen === "stock-detail") return <StockPreview />;
  if (screen === "milk-flag") return <MilkFlagPreview />;

  if (screen === "checklist" || screen === "checklist-open") {
    return <ChecklistPreview showOpen={screen === "checklist-open"} />;
  }

  if (screen === "home-one" || screen === "home-two" || screen === "home-none") return <HomeLook screen={screen} />;
  if (screen === "stock-tech") return <StockTechLook />;
  if (screen === "stock-admin") return <StockAdminLook />;
  if (screen === "dupont") return <DupontLook />;
  if (screen === "low-out") return <LowOutLook />;
  if (screen === "flag") return <FlagLook />;
  if (screen === "pay-now") return <PayNowLook />;
  if (screen === "pay-past") return <PayPastLook />;
  if (screen === "schedule") return <ScheduleLook />;
  if (screen === "stock") return <StockLook />;
  if (screen === "learn") return <LearnLook />;
  if (screen === "pay") return <PayLook />;
  if (screen === "payroll") return <PayrollLook />;
  if (screen === "charges") return <ChargeLook />;

  if (screen === "training") {
    return (
      <Screen>
        <PracticeBanner show />
        <Title sub="Series 3.5 E">Training</Title>
        <p className="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          Read the guide, then take the quiz.
        </p>
        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <h2 className="font-semibold">Why</h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-700">
            Prep comes before milk cleaning because touching the Cameo aborts the cleaning. It is about 11 minutes.
            Turn all three powder spouts back down, or powder drinks come out as hot water.
          </p>
        </section>
      </Screen>
    );
  }

  return <AddPersonPage preview previewSites={sites} />;
}

function CorrectionPreview() {
  const glance = correctionGlance({
    serviceDate: "2026-11-05",
    startAt: "2026-11-05T23:02:00.000Z",
    endAt: "2026-11-05T23:23:00.000Z",
    requestedStart: null,
    requestedEnd: "2026-11-06T00:02:00.000Z",
  });
  return (
    <Screen>
      <Title sub="Approve from the lengths, not the timestamps.">Corrections</Title>
      <Card>
        <CorrectionGlanceView glance={glance} who="Kajsa · RBC" reason="Left at 7, the end time was the arrival." status="pending" />
      </Card>
    </Screen>
  );
}

function StockPreview() {
  return (
    <Screen>
      <Title sub="Live stock. Dupont is the warehouse. A site is what is there.">Stock</Title>
      <Card>
        <h2 className="font-semibold">Add, take, or recount one item</h2>
        <p className="mt-1 text-sm text-stone-600">Place remembered — pick an item, enter quantity, save.</p>
        <p className="mt-3 text-base font-semibold">12 oz hot cups</p>
        <p className="text-sm text-stone-600">Where: Dupont · Enter as: sleeve (50 cups)</p>
        <p className="mt-2 text-sm font-medium text-stone-700">Saves as 1 sleeve of 50 = 50 cups</p>
        <p className="mt-2 text-sm text-stone-600">On hand here: 1050 cups (1 box + 1 sleeve)</p>
        <p className="mt-2 text-sm text-stone-600">
          Reorder below 1 box (1000 cups) · target 2 boxes (2000 cups) · Count in cups.
        </p>
        <Button className="mt-3">Save</Button>
      </Card>
      <Card className="mt-3">
        <p className="font-semibold">Oat milk</p>
        <p className="text-sm text-amber-900">Reorder below 2 boxes (12 cartons) · target 3 boxes (18 cartons) · below reorder now</p>
      </Card>
      <Card className="mt-3">
        <p className="font-semibold">12 oz cold cups</p>
        <p className="text-sm font-medium text-amber-900">Phase-out · sell-through only (no reorder)</p>
      </Card>
    </Screen>
  );
}

function MilkFlagPreview() {
  return (
    <Screen>
      <Title sub="2026-11-13">Today</Title>
      <div className="grid gap-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="text-xl font-semibold">UofT</div>
          <div className="mt-2 text-base font-semibold text-stone-800">Due today</div>
          <p className="mt-1 text-sm text-stone-500">Best before 11am or after 3pm</p>
          <p className="mt-1 text-sm font-medium text-amber-900">Buy milk on the way</p>
        </div>
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="text-xl font-semibold">Sinai</div>
          <div className="mt-2 text-base font-semibold text-stone-800">Due today</div>
        </div>
      </div>
    </Screen>
  );
}

function ToastPreview() {
  const [endNotice, setEndNotice] = useState<EndNotice | null>(null);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const shown = visibleEndNotice(endNotice, leaveAsk);

  useEffect(() => {
    if (!successToast(endNotice)) return;
    const timer = window.setTimeout(() => setEndNotice(null), SUCCESS_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [endNotice]);

  return (
    <Screen>
      <Title sub="Pause toast must not cover this">Incomplete today</Title>
      <button
        type="button"
        className="min-h-12 rounded-2xl bg-white px-4 font-semibold ring-1 ring-stone-200"
        onClick={() => setEndNotice({ kind: "saved", iso: "2026-11-06T04:45:00.000Z" })}
      >
        Pause servicing
      </button>
      <button
        type="button"
        className="mt-2 min-h-12 rounded-2xl bg-white px-4 font-semibold ring-1 ring-stone-200"
        onClick={() => {
          setEndNotice((current) => (successToast(current) ? null : current));
          setLeaveAsk(true);
        }}
      >
        Incomplete today
      </button>
      {leaveAsk ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="mx-auto w-full max-w-[480px] rounded-3xl bg-white p-4">
            <h2 id="leave-title" className="text-xl font-semibold">Incomplete today?</h2>
            <p className="mt-2 text-sm text-stone-600">Are you sure? This does not finish the checklist.</p>
            <button type="button" className="mt-3 min-h-12 w-full rounded-2xl bg-[var(--accent)] font-semibold text-white" onClick={() => setLeaveAsk(false)}>
              Go back
            </button>
          </div>
        </div>
      ) : null}
      <div className="fixed inset-x-0 z-30 mx-auto w-full max-w-[480px] px-4" style={{ bottom: "var(--nav-stack)" }} data-toast={shown ? "visible" : "hidden"}>
        {shown?.kind === "saved" ? (
          <p className="mb-2 rounded-2xl bg-amber-100 px-3 py-3 text-base font-semibold text-stone-900 shadow-sm ring-1 ring-amber-300">
            Paused. Clock-out saved at 11:45 PM. {CLOCK_OUT_SAVED} Resume it from Home.
          </p>
        ) : null}
      </div>
    </Screen>
  );
}

function ChecklistPreview({ showOpen }: { showOpen: boolean }) {
  const [highlight, setHighlight] = useState(showOpen ? "step-pucks" : "");
  const [freshAsk, setFreshAsk] = useState(false);
  const [freshError, setFreshError] = useState("");
  return (
    <Screen>
      <PracticeBanner show />
      <p className="text-sm font-semibold text-[var(--accent)]">Home</p>
      <h1 className="mt-1 text-3xl font-semibold">PRACTICE Sinai</h1>
        <p className="text-stone-600">PRACTICE – Sinai (3.5)</p>
        <Button tone="quiet" className="mt-3 w-full" onClick={() => { setFreshError(""); setFreshAsk(true); }}>
          Start a fresh practice visit
        </Button>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-stone-900 px-3 py-2 text-white">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-300">Milk cleaning</p>
          <p className="text-2xl font-semibold leading-none" aria-live="polite">12:40</p>
        </div>
        <button type="button" className={composeButtonClass("quiet", "shrink-0 px-3")}>Mark cleaning done</button>
      </div>
      <div className="mt-4 grid gap-2">
        <MilkStepCard
          stepId="step-milk"
          title="Start milk module cleaning"
          minutes={11}
          started={showOpen}
          countedDone={showOpen}
          notNeeded={false}
          startDisabled={showOpen}
          details="Cameo menu button (top middle) → Clean → follow the screen. Leave the module alone until the timer finishes."
          initialDetailsOpen={showOpen}
        />
        <CheckItem
          stepId="step-sign-in"
          title="Sign in to KC Manager: scan your QR code at the kiosk and confirm the site name on the screen"
          detail={null}
          placeholder={null}
          howTo="Hold the phone steady. If the camera misses the code, type the site name from the kiosk bezel."
          state="done"
          initialDetailsOpen={showOpen}
        />
        <CheckItem
          stepId="step-pucks"
          title="Empty pucks, if needed"
          detail="Overdue. It has been 2 or more days since it was emptied."
          placeholder={null}
          overdue
          highlighted={highlight === "step-pucks"}
        />
        <CheckItem
          stepId="step-sensor"
          title="Arm sensor check"
          detail={null}
          placeholder="Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see."
          note={showOpen ? "Left sensor blinked twice, then stayed green." : ""}
          initialNoteOpen={showOpen}
        />
        <CheckItem
          stepId="step-wipe"
          title="Wipe the Cameo"
          detail={null}
          placeholder={null}
          doneLocked={showOpen}
          skipLocked={false}
          lockMessage={showOpen ? MILK_LOCK_NOT_NEEDED_OK : null}
        />
      </div>
      <div className="mt-3 grid gap-2" role="alert">
        <p className="text-sm font-medium text-red-700">Still open. Tap a step to go to it.</p>
        <button
          type="button"
          className="min-h-12 rounded-2xl bg-red-50 px-3 text-left text-base font-semibold text-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => {
            setHighlight("step-pucks");
            const card = document.getElementById("step-pucks");
            card?.scrollIntoView({ behavior: "auto", block: "center" });
            card?.focus({ preventScroll: true });
          }}
        >
          Empty pucks, if needed
        </button>
      </div>
      {freshAsk ? (
        <FreshPracticeDialog
          error={freshError}
          busy={false}
          onClose={() => { setFreshAsk(false); setFreshError(""); }}
          onConfirm={() => {
            const gate = assessFreshStart(false, true, 0);
            setFreshError(gate.message || FRESH_OFFLINE);
          }}
        />
      ) : null}
      <div className="fixed inset-x-0 z-30 mx-auto w-full max-w-[480px] px-4" style={{ bottom: "var(--nav-stack)" }}>
        <div className="grid gap-2">
          <button type="button" className="min-h-12 w-full rounded-2xl bg-[var(--accent)] text-base font-semibold text-white shadow-lg">Complete servicing</button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-12 rounded-2xl bg-white text-base font-semibold text-stone-800 shadow-lg ring-1 ring-stone-200">Pause servicing</button>
            <button type="button" className="min-h-12 rounded-2xl bg-white text-base font-semibold text-stone-800 shadow-lg ring-1 ring-stone-200">Incomplete today</button>
          </div>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-[var(--bg)] pb-[env(safe-area-inset-bottom)]">
        <p className="mx-auto max-w-[480px] px-3 pt-1 text-center text-[11px] leading-tight text-stone-500">Build ui-2026-11-15-edit-charges</p>
        <div className="mx-auto grid min-h-16 max-w-[480px] grid-cols-3 text-center text-sm font-semibold">
          <span className="flex min-h-16 items-center justify-center">Home</span>
          <span className="flex min-h-16 items-center justify-center">Training</span>
          <span className="flex min-h-16 items-center justify-center">My time</span>
        </div>
      </nav>
    </Screen>
  );
}

function HomeLook({ screen }: { screen: string }) {
  const sinai = { siteId: "sinai", shortName: "Sinai", name: "Mount Sinai Hospital", action: "Start visit", detail: "Due today" };
  const uoft = { siteId: "uoft", shortName: "UofT", name: "UofT Sidney Smith", action: "Continue visit", detail: "Resume this visit." };
  const outstanding = screen === "home-none" ? [] : screen === "home-two" ? [sinai, uoft] : [sinai];
  return (
    <>
      <TodayView
        dateLabel="Mon, Nov 16"
        outstanding={outstanding}
        doneToday={[]}
        stockFlags={screen === "home-one" ? 2 : 0}
        coverageOpen={0}
        nextShifts={screen === "home-none" ? [{ date: "2026-11-18", siteId: "uoft", shortName: "UofT" }] : [{ date: "2026-11-17", siteId: "sinai", shortName: "Sinai" }]}
        showNext={outstanding.length > 0}
      />
      <PreviewTabs active="Today" />
    </>
  );
}

function ScheduleLook() {
  return (
    <Screen>
      <Title sub="Your service days, coverage, and past visits.">Schedule</Title>
      <h2 className="mb-2 text-xl font-semibold">Coming up</h2>
      <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">Mon, Nov 16</p>
        <p className="mt-2 flex min-h-12 items-center justify-between text-lg font-semibold">Sinai <span className="text-sm font-semibold text-[var(--accent)]">Open</span></p>
      </div>
      <div className="mt-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <p className="text-sm font-semibold uppercase tracking-wide text-stone-500">Wed, Nov 18</p>
        <p className="mt-2 flex min-h-12 items-center text-lg font-semibold">UofT</p>
      </div>
      <h2 className="mb-2 mt-6 text-xl font-semibold">Coverage</h2>
      <Card>
        <h2 className="font-semibold">Request coverage</h2>
        <Field label="Site"><select className={inputClass} defaultValue="sinai"><option value="sinai">Sinai</option></select></Field>
        <Field label="Date"><input className={inputClass} type="date" defaultValue="2026-11-18" readOnly /></Field>
        <Button>Request coverage</Button>
      </Card>
      <h2 className="mb-2 mt-6 text-xl font-semibold">Past visits</h2>
      <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5">
        <p className="font-semibold">Kajsa · 2026-11-13</p>
        <p className="text-sm text-stone-600">9:05 AM to 10:10 AM · 1h 5m</p>
      </div>
      <PreviewTabs active="Schedule" />
    </Screen>
  );
}

function StockLook() {
  return (
    <Screen>
      <Title sub="Counts and flags, in one place.">Stock</Title>
      <Card>
        <h2 className="text-lg font-semibold">Flag an item</h2>
        <p className="mt-1 text-sm text-stone-600">Low or out. One tap here, or on a step during a visit.</p>
        <Field label="Kiosk"><select className={inputClass} defaultValue="sinai"><option>Sinai</option></select></Field>
        <p className="mb-2 text-sm font-medium text-stone-600">Item</p>
        <p className="rounded-2xl bg-white px-4 py-3 font-semibold ring-1 ring-stone-200">Oat milk</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button tone="quiet">Low</Button>
          <Button tone="quiet">Out</Button>
          <Button tone="quiet">Restocked</Button>
        </div>
        <p className="mt-3 text-sm">Oat milk · low</p>
      </Card>
      <Card className="mt-4">
        <h2 className="font-semibold">Add, take, or recount one item</h2>
        <Field label="Where"><select className={inputClass} defaultValue="sinai"><option>Sinai</option></select></Field>
        <Button>Save</Button>
      </Card>
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function LearnLook() {
  return (
    <Screen>
      <Title sub="Guides, then a practice visit that never changes live work.">Learn</Title>
      <Card className="mb-5">
        <h2 className="text-lg font-semibold">Practice</h2>
        <p className="mt-1 text-sm text-stone-600">Practice visits stay separate from live visits.</p>
        <Button className="mt-3 w-full" tone="quiet">Start a practice visit</Button>
      </Card>
      <h2 className="mb-3 text-xl font-semibold">Guides</h2>
      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <div className="text-xl font-semibold">Series 3.5 E</div>
        <div className="text-sm text-stone-600">In training</div>
      </div>
      <PreviewTabs active="Learn" />
    </Screen>
  );
}

function PayLook() {
  return (
    <Screen>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <span className="flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-base font-semibold text-white">Shifts</span>
        <span className="flex min-h-12 items-center justify-center rounded-2xl bg-white text-base font-semibold text-stone-800 ring-1 ring-stone-200">Reimbursements</span>
      </div>
      <Title sub="A shift you worked is just a shift you worked.">Your pay</Title>
      <Card>
        <p className="font-semibold">$54.38</p>
        <p className="text-sm text-stone-600">2026-11-09 to 2026-11-15 · paid 2026-11-16 · Paid</p>
        <ul className="mt-2 grid gap-1 text-sm text-stone-700">
          <li>Mon Nov 9 · UofT · 9:05 AM–10:10 AM</li>
          <li>Wed Nov 11 · Sinai · 2:00 PM–3:20 PM</li>
        </ul>
      </Card>
      <PreviewTabs active="Pay" />
    </Screen>
  );
}

function PayrollLook() {
  return (
    <Screen>
      <p className="text-sm font-semibold text-[var(--accent)]">Admin</p>
      <Title sub="Nov 9 to Nov 15. Shifts stay hourly. Trips are a flat rate. Reimbursements are listed on their own.">Payroll</Title>
      <p className="mb-4 font-semibold text-[var(--accent)]">Pay rates</p>
      <Card>
        <p className="text-lg font-semibold">Kajsa</p>
        <p className="mt-3 font-medium">Mon Nov 9 · UofT</p>
        <p className="text-sm text-stone-600">9:05 AM–10:10 AM · 65 min · $22.00/hr · $23.83 · Scheduled</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button>Pay</Button>
          <Button tone="quiet">Not yet paid</Button>
        </div>
        <p className="mt-3 font-medium">Wed Nov 11 · Sinai</p>
        <p className="text-sm text-stone-600">2:00 PM–3:20 PM · 80 min · $22.00/hr · $29.33 · Covered</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button>Pay</Button>
          <Button tone="quiet">Not yet paid</Button>
        </div>
        <p className="mt-3 font-semibold">Shifts $53.16</p>
        <h3 className="mt-4 font-semibold">Trips</h3>
        <p className="mt-2 font-medium">Wed Nov 11 · Milk run · Sinai, UofT</p>
        <p className="text-sm text-stone-600">$10.00 · Receipt not in yet</p>
        <p className="mt-2 font-semibold">Trips $10.00</p>
        <h3 className="mt-4 font-semibold">Reimbursements</h3>
        <p className="mt-2 font-medium">Milk run</p>
        <p className="text-sm text-stone-600">Wed Nov 11 · $6.40 · Waiting for receipt</p>
        <p className="mt-2 font-medium">Cups</p>
        <p className="text-sm text-stone-600">Tue Nov 10 · $12.50 · Paid</p>
        <p className="mt-2 font-semibold">Reimbursements $12.50</p>
        <p className="mt-3 text-lg font-semibold">To pay $75.66</p>
        <p className="text-sm text-stone-600">Includes $12.50 already paid on Charges. Marking this week paid will not pay that again.</p>
        <Button className="mt-3 w-full">Mark paid</Button>
      </Card>
      <PreviewTabs active="Pay" admin />
    </Screen>
  );
}

function ChargeLook() {
  return (
    <Screen>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <span className="flex min-h-12 items-center justify-center rounded-2xl bg-white text-base font-semibold text-stone-800 ring-1 ring-stone-200">Shifts</span>
        <span className="flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-base font-semibold text-white">Reimbursements</span>
      </div>
      <Title sub="Log a purchase for reimbursement. No email is sent.">Labour & reimbursements</Title>
      <Card className="mb-4">
        <h2 className="font-semibold">Edit charge</h2>
        <Field label="Amount"><input className={inputClass} value="18.40" readOnly /></Field>
        <Field label="Site (optional)"><select className={inputClass} defaultValue="uoft"><option>UofT</option></select></Field>
        <Field label="What for"><input className={inputClass} value="Oat milk" readOnly /></Field>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button tone="quiet">Cancel</Button>
          <Button>Save changes</Button>
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Add a charge</h2>
        <Field label="Amount"><input className={inputClass} placeholder="0.00" readOnly /></Field>
        <Field label="What for"><input className={inputClass} placeholder="e.g. milk" readOnly /></Field>
        <Button>Save charge</Button>
      </Card>
      <PreviewTabs active="Pay" />
    </Screen>
  );
}

const cupPacks = [
  { name: "sleeve", perBase: 50 },
  { name: "box", perBase: 1000 },
];
const oatPacks = [{ name: "box", perBase: 6 }];

function demoRows() {
  const oat = toWarehouseRow({ skuId: "oat", name: "Oat milk", baseUnit: "cartons", onHand: 6, reorderBelow: 12, packs: oatPacks });
  const cups = toWarehouseRow({ skuId: "cups", name: "12 oz hot cups", baseUnit: "cups", onHand: 0, reorderBelow: 1000, packs: cupPacks });
  const lids = toWarehouseRow({ skuId: "lids", name: "Lids", baseUnit: "lids", onHand: 2000, reorderBelow: 1000, packs: [{ name: "box", perBase: 1000 }] });
  return [oat, cups, lids].map((row) => ({ ...row, draft: 0 }));
}

function StockTechLook() {
  return (
    <Screen>
      <Title sub="Low, out, or OK at each place. Dupont is the warehouse.">Stock</Title>
      <StockGlanceView
        locations={[
          { id: "sinai", name: "Sinai", status: "out" },
          { id: "uoft", name: "UofT", status: "low" },
        ]}
        dupontStatus="reorder"
        lowCount={2}
        reorderItems={null}
      />
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function StockAdminLook() {
  const rows = demoRows().filter((row) => row.reorder);
  return (
    <Screen>
      <Title sub="Low, out, or OK at each place. Dupont is the warehouse.">Stock</Title>
      <ReorderBanner items={rows.map((row) => ({ id: row.skuId, name: row.name, amount: row.amount }))} />
      <StockGlanceView
        locations={[
          { id: "sinai", name: "Sinai", status: "out" },
          { id: "uoft", name: "UofT", status: "low" },
        ]}
        dupontStatus="reorder"
        lowCount={2}
        reorderItems={null}
      />
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function DupontLook() {
  const rows = demoRows().map((row) => (row.skuId === "oat" ? { ...row, draft: 1, amount: "2 boxes", reorder: false } : row));
  return (
    <Screen>
      <p className="text-sm font-semibold text-[var(--accent)]">Stock</p>
      <Title sub="Minus or plus one pack, then Save. Each save is a recount on the stock history.">Dupont</Title>
      <WarehouseListView rows={rows} busyId="" onStep={() => undefined} onSave={() => undefined} />
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function LowOutLook() {
  return (
    <Screen>
      <p className="text-sm font-semibold text-[var(--accent)]">Stock</p>
      <Title sub="Every item flagged low or out. Status only.">Low or out</Title>
      <LowOutListView
        rows={[
          { id: "1", place: "Sinai", item: "Oat milk", status: "out" },
          { id: "2", place: "UofT", item: "12 oz hot cups", status: "low" },
        ]}
      />
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function FlagLook() {
  return (
    <Screen>
      <Title>Stock</Title>
      <Card>
        <h2 className="text-lg font-semibold">Flag an item</h2>
        <p className="mt-1 text-sm text-stone-600">Pick a location, pick an item, then mark it.</p>
        <Field label="Location">
          <select className={inputClass} defaultValue="sinai"><option>Sinai</option></select>
        </Field>
        <p className="mb-2 text-sm font-medium text-stone-600">Item</p>
        <p className="rounded-2xl bg-[var(--accent)] px-4 py-3 font-semibold text-white">Oat milk</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button tone="quiet">Low</Button>
          <Button tone="quiet">Out</Button>
          <Button tone="quiet">Restocked</Button>
        </div>
      </Card>
      <PreviewTabs active="Stock" />
    </Screen>
  );
}

function PayNowLook() {
  return (
    <Screen>
      <PayPeriodDetailView
        heading="This period"
        detail={{
          from: "2026-11-16",
          to: "2026-11-22",
          shifts: [{ date: "2026-11-16", site: "Sinai", minutes: 65, amount: 23.83 }],
          trips: [{ date: "2026-11-18", kind: "milk_run", sites: ["Sinai", "UofT"], note: "", amount: 10, milkCost: 6.4, receiptReceived: false }],
          reimbursements: [
            { date: "2026-11-16", note: "Oat milk", amount: 18.4 },
            { date: "2026-11-18", note: "Milk run", amount: 6.4, held: true },
          ],
          shiftsTotal: 23.83,
          tripsTotal: 10,
          reimbursementsTotal: 18.4,
          alreadyPaidTotal: 0,
          total: 52.23,
          toPay: 52.23,
        }}
        past={[{ from: "2026-11-09", to: "2026-11-15" }]}
        onPast={() => undefined}
      />
      <PreviewTabs active="Pay" />
    </Screen>
  );
}

function PayPastLook() {
  return (
    <Screen>
      <PayPeriodDetailView
        heading="Past period"
        detail={{
          from: "2026-11-09",
          to: "2026-11-15",
          shifts: [
            { date: "2026-11-09", site: "UofT", minutes: 65, amount: 23.83 },
            { date: "2026-11-11", site: "Sinai", minutes: 80, amount: 29.33 },
          ],
          trips: [{ date: "2026-11-11", kind: "warehouse_pickup", sites: [], note: "", amount: 12 }],
          reimbursements: [{ date: "2026-11-10", note: "Cups", amount: 12.5 }],
          shiftsTotal: 53.16,
          tripsTotal: 12,
          reimbursementsTotal: 12.5,
          alreadyPaidTotal: 0,
          total: 77.66,
          toPay: 77.66,
        }}
        past={[]}
        onCurrent={() => undefined}
      />
      <PreviewTabs active="Pay" />
    </Screen>
  );
}
