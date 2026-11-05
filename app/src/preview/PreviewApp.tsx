import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { AddPersonPage } from "../screens/Admin";
import type { SiteRow } from "../lib/types";
import { CheckItem, PinPad, PracticeBanner, Screen, Title } from "../ui";

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
    document.documentElement.dataset.mode = screen === "checklist" || screen === "training" ? "practice" : "live";
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

  if (screen === "checklist") {
    return (
      <Screen>
        <PracticeBanner show />
        <p className="text-sm font-semibold text-[var(--accent)]">Home</p>
        <h1 className="mt-2 text-3xl font-semibold">PRACTICE Sinai</h1>
        <p className="text-stone-600">PRACTICE – Sinai (3.5)</p>
        <div className="mt-4 rounded-3xl bg-stone-900 px-4 py-4 text-white">
          <p className="text-sm uppercase tracking-wide text-stone-300">Milk cleaning</p>
          <p className="text-3xl font-semibold">12:40</p>
        </div>
        <div className="mt-5 grid gap-3 pb-20">
          <CheckItem
            title="Empty pucks, if needed"
            detail="Overdue. It has been 2 or more days since it was emptied."
            placeholder={null}
            overdue
            onDone={() => undefined}
            onSkip={() => undefined}
          />
          <CheckItem
            title="Arm sensor check"
            detail={null}
            placeholder="Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see."
            onDone={() => undefined}
            onSkip={() => undefined}
          />
        </div>
        <div className="fixed inset-x-0 bottom-4 mx-auto w-full max-w-[480px] px-4">
          <button type="button" className="min-h-12 w-full rounded-2xl bg-[var(--accent)] font-semibold text-white">End now</button>
        </div>
      </Screen>
    );
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
            Prep comes before milk cleaning because touching the Cameo aborts the cleaning. It is about 18 minutes.
            Turn all three powder spouts back down, or powder drinks come out as hot water.
          </p>
        </section>
      </Screen>
    );
  }

  return <AddPersonPage preview previewSites={sites} />;
}
