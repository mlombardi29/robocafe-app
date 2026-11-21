import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, supabaseConfigured } from "./lib/supabase";
import type { Profile } from "./lib/types";
import { watchSync } from "./lib/sync";

type AuthValue = {
  configured: boolean;
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!session) return;
    return watchSync();
  }, [session]);

  const profileQuery = useQuery({
    queryKey: ["profile", session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_profile");
      if (error) throw new Error(error.message);
      return data as Profile;
    },
  });

  const value = useMemo<AuthValue>(
    () => ({
      configured: supabaseConfigured,
      ready,
      session,
      profile: profileQuery.data ?? null,
      profileError: profileQuery.error instanceof Error ? profileQuery.error.message : null,
      refreshProfile: async () => {
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
      },
    }),
    [ready, session, profileQuery.data, profileQuery.error, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
