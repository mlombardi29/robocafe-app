import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { anonKey, functionUrl, supabase, supabaseConfigured } from "../lib/supabase";
import { Button, ErrorText, PinPad, Screen, Title } from "../ui";

type Name = { id: string; goes_by: string };

export function SignInPage() {
  const navigate = useNavigate();
  const [names, setNames] = useState<Name[]>([]);
  const [person, setPerson] = useState<Name | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    fetch(functionUrl("pin-login"), {
      headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Names are unavailable.");
        return (await res.json()) as Name[];
      })
      .then((rows) => {
        if (active) setNames(rows);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(nextPin = pin) {
    if (!person || nextPin.length < 4 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(functionUrl("pin-login"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: anonKey(),
          Authorization: `Bearer ${anonKey()}`,
        },
        body: JSON.stringify({ person_id: person.id, pin: nextPin }),
      });
      const body = (await res.json()) as {
        error?: string;
        minutes_left?: number;
        access_token?: string;
        refresh_token?: string;
        must_change_pin?: boolean;
      };
      if (!res.ok || !body.access_token || !body.refresh_token) {
        const wait = body.minutes_left ? ` Try again in ${body.minutes_left} min.` : "";
        throw new Error((body.error ?? "Sign-in failed.") + wait);
      }
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
      if (sessionError) throw new Error(sessionError.message);
      navigate(body.must_change_pin ? "/set-pin" : "/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (!supabaseConfigured) {
    return (
      <Screen>
        <Title sub="Add the Supabase URL and anon key, then reload.">KioskOps is not connected yet</Title>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title sub={person ? `Hi ${person.goes_by}. Enter your PIN.` : "Tap your name."}>KioskOps</Title>
      {person ? (
        <>
          <PinPad
            value={pin}
            disabled={busy}
            onChange={(next) => {
              setPin(next);
              if (next.length === 6) void submit(next);
            }}
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button tone="quiet" disabled={busy} onClick={() => { setPerson(null); setPin(""); setError(""); }}>
              Back
            </Button>
            <Button disabled={busy || pin.length < 4} onClick={() => void submit()}>
              {busy ? "Checking" : "Sign in"}
            </Button>
          </div>
        </>
      ) : (
        <div className="grid gap-3">
          {names.map((name) => (
            <Button key={name.id} tone="quiet" className="text-left text-lg" onClick={() => setPerson(name)}>
              {name.goes_by}
            </Button>
          ))}
          {names.length === 0 && !error ? <p className="text-stone-600">Loading names…</p> : null}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
