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
import { Button, Card, CheckItem, FreshPracticeDialog, MilkStepCard, PinPad, PracticeBanner, Screen, Title } from "../ui";

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
    opening_time: null,
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

  if (screen === "checklist" || screen === "checklist-open") {
    return <ChecklistPreview showOpen={screen === "checklist-open"} />;
  }

  if (screen === "training") {
    return (
      <Screen>
        <PracticeBanner show />
        <Title sub="Series 3.5 E">Training</Title>
        <p className="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
          Draft for Michael to review. The quiz is not final.
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
        <p className="mx-auto max-w-[480px] px-3 pt-1 text-center text-[11px] leading-tight text-stone-500">Build ui-2026-11-07-ops</p>
        <div className="mx-auto grid min-h-16 max-w-[480px] grid-cols-3 text-center text-sm font-semibold">
          <span className="flex min-h-16 items-center justify-center">Home</span>
          <span className="flex min-h-16 items-center justify-center">Training</span>
          <span className="flex min-h-16 items-center justify-center">My time</span>
        </div>
      </nav>
    </Screen>
  );
}
