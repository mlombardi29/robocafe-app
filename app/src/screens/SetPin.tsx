import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pinError } from "../../../supabase/functions/_shared/pinPolicy";
import { useAuth } from "../auth";
import { supabase } from "../lib/supabase";
import { Button, ErrorText, PinPad, Screen, Title } from "../ui";

export function SetPinPage() {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const mustChange = profile?.must_change_pin ?? true;
  const [stage, setStage] = useState<"current" | "next" | "confirm">(mustChange ? "next" : "current");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile && !profile.must_change_pin) setStage("current");
  }, [profile]);

  const value = stage === "current" ? current : stage === "next" ? next : confirm;
  const setValue = stage === "current" ? setCurrent : stage === "next" ? setNext : setConfirm;

  async function save(confirmed = confirm) {
    const problem = pinError(next);
    if (problem) {
      setError(problem);
      return;
    }
    if (confirmed !== next) {
      setError("Those PINs do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("set-pin", {
        body: { current_pin: mustChange ? undefined : current, new_pin: next },
      });
      if (fnError) throw new Error("Could not save the PIN.");
      const body = data as { error?: string };
      if (body?.error) throw new Error(body.error);
      await refreshProfile();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the PIN.");
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    setError("");
    if (stage === "current") setStage("next");
    else if (stage === "next") {
      const problem = pinError(next);
      if (problem) setError(problem);
      else setStage("confirm");
    } else void save();
  }

  const copy =
    stage === "current" ? "Enter your current PIN." : stage === "next" ? "Choose a new PIN. 4 to 6 digits." : "Enter the new PIN again.";

  return (
    <Screen>
      <Title sub={copy}>Set a PIN</Title>
      <PinPad value={value} disabled={busy} onChange={setValue} />
      <Button className="mt-4 w-full" disabled={busy || value.length < 4} onClick={advance}>
        {stage === "confirm" ? (busy ? "Saving" : "Save PIN") : "Continue"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
