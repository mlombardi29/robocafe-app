import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { UI_BUILD } from "./lib/appUpdate";
import { READ_GC_MS, READ_STALE_MS } from "./lib/queryDefaults";
import { supabase } from "./lib/supabase";
import { inPractice } from "./lib/access";
import {
  AccessPage,
  AddPersonPage,
  AdminHome,
  ChecklistPage,
  CorrectionsPage,
  OffboardingPage,
  PeoplePage,
  PracticeResetPage,
  ShowsPage,
  TraineesPage,
} from "./screens/Admin";
import { HistoryPage, HistoryVisitPage } from "./screens/History";
import { InventoryPage } from "./screens/Inventory";
import { ImportPreviewPage } from "./screens/ImportPreview";
import { DuplicateSessionsPage } from "./screens/DuplicateSessions";
import { SettingsPage } from "./screens/Settings";
import { StockHistoryPage } from "./screens/StockHistory";
import { FlagsPage, PhotoReviewPage, PickupPage } from "./screens/VisitOps";
import { ChargesPage } from "./screens/Charges";
import { CoveragePage } from "./screens/Coverage";
import { PayHome, PayRatesPage, PayrollPage } from "./screens/Payroll";
import { HomePage } from "./screens/Home";
import { SchedulePage } from "./screens/Schedule";
import { ServicePage } from "./screens/Service";
import { SetPinPage } from "./screens/SetPin";
import { SignInPage } from "./screens/SignIn";
import { TimePage } from "./screens/Time";
import { QuizPage, TrainingHome, TrainingModelPage } from "./screens/Training";
import { TabGlyph, type TabIcon } from "./navIcons";
import { PracticeBanner } from "./ui";
import { UpdatePrompt } from "./updatePrompt";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: READ_STALE_MS,
      gcTime: READ_GC_MS,
    },
  },
});

const PreviewApp = import.meta.env.DEV ? lazy(() => import("./preview/PreviewApp")) : null;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <UpdatePrompt />
          <Routes>
            {PreviewApp ? <Route path="/__preview/:screen" element={<Suspense fallback={null}><PreviewApp /></Suspense>} /> : null}
            <Route path="/signin" element={<SignInPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/set-pin" element={<SetPinPage />} />
              <Route element={<Shell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/service/:siteId" element={<ServicePage />} />
                <Route path="/schedule" element={<SchedulePage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/history/:sessionId" element={<HistoryVisitPage />} />
                <Route path="/time" element={<TimePage />} />
                <Route path="/pay" element={<PayHome />} />
                <Route path="/charges" element={<Navigate to="/pay?tab=reimbursements" replace />} />
                <Route path="/coverage" element={<Navigate to="/schedule" replace />} />
                <Route path="/flags" element={<Navigate to="/inventory" replace />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/stock-history" element={<StockHistoryPage />} />
                <Route path="/flags" element={<FlagsPage />} />
                <Route path="/pickup/:siteId" element={<PickupPage />} />
                <Route path="/training" element={<TrainingHome />} />
                <Route path="/training/:code" element={<TrainingModelPage />} />
                <Route path="/training/:code/quiz" element={<QuizPage />} />
                <Route path="/admin" element={<AdminOnly><AdminHome /></AdminOnly>} />
                <Route path="/admin/people/new" element={<AdminOnly><AddPersonPage /></AdminOnly>} />
                <Route path="/admin/people" element={<AdminOnly><PeoplePage /></AdminOnly>} />
                <Route path="/admin/corrections" element={<AdminOnly><CorrectionsPage /></AdminOnly>} />
                <Route path="/admin/trainees" element={<AdminOnly><TraineesPage /></AdminOnly>} />
                <Route path="/admin/shows" element={<AdminOnly><ShowsPage /></AdminOnly>} />
                <Route path="/admin/coverage" element={<AdminOnly><CoveragePage /></AdminOnly>} />
                <Route path="/admin/charges" element={<AdminOnly><ChargesPage /></AdminOnly>} />
                <Route path="/admin/checklist" element={<AdminOnly><ChecklistPage /></AdminOnly>} />
                <Route path="/admin/payroll" element={<AdminOnly><PayrollPage /></AdminOnly>} />
                <Route path="/admin/payroll/rates" element={<AdminOnly><PayRatesPage /></AdminOnly>} />
                <Route path="/admin/practice" element={<AdminOnly><PracticeResetPage /></AdminOnly>} />
                <Route path="/admin/offboarding" element={<AdminOnly><OffboardingPage /></AdminOnly>} />
                <Route path="/admin/access" element={<AdminOnly><AccessPage /></AdminOnly>} />
                <Route path="/admin/photos" element={<AdminOnly><PhotoReviewPage /></AdminOnly>} />
                <Route path="/admin/import" element={<AdminOnly><ImportPreviewPage /></AdminOnly>} />
                <Route path="/admin/duplicates" element={<AdminOnly><DuplicateSessionsPage /></AdminOnly>} />
                <Route path="/admin/stock-history" element={<AdminOnly><StockHistoryPage /></AdminOnly>} />
                <Route path="/admin/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function RequireAuth() {
  const { configured, ready, session, profile, profileError } = useAuth();
  const location = useLocation();
  if (!configured) return <SignInPage />;
  if (!ready || (session && !profile && !profileError)) return <p className="p-6 text-stone-600">Loading…</p>;
  if (!session) return <Navigate to="/signin" replace />;
  if (profileError) return <p className="p-6 text-red-700">{profileError}</p>;
  if (profile?.must_change_pin && location.pathname !== "/set-pin") return <Navigate to="/set-pin" replace />;
  return <Outlet />;
}

function Shell() {
  const { profile } = useAuth();
  const practice = profile ? inPractice(profile.role, profile.mode) : false;
  useEffect(() => {
    document.documentElement.dataset.mode = practice ? "practice" : "live";
  }, [practice]);
  const admin = profile?.role === "admin";
  useEffect(() => {
    const base = admin ? "8.25rem" : "4.75rem";
    document.documentElement.style.setProperty("--nav-stack", `calc(${base} + env(safe-area-inset-bottom))`);
  }, [admin]);
  const pending = useQuery({
    queryKey: ["corrections-count"],
    enabled: admin,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("time_corrections")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
  return (
    <>
      <div className="mx-auto w-full max-w-[480px] px-4 pt-3">
        <PracticeBanner show={practice} />
      </div>
      <Outlet />
      <p className="sr-only">Build {UI_BUILD}</p>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        {admin ? (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `mx-auto flex min-h-12 max-w-[480px] items-center justify-center gap-2 border-b border-black/5 text-base font-semibold ${isActive ? "text-[var(--accent)]" : "text-stone-800"}`
            }
          >
            Admin
            {(pending.data ?? 0) > 0 ? (
              <span className="min-w-6 rounded-full bg-red-700 px-1 text-xs font-bold text-white">{pending.data}</span>
            ) : null}
          </NavLink>
        ) : null}
        <div className="mx-auto grid max-w-[480px] grid-cols-5">
          <Tab to="/" end icon="today" match={(path) => path === "/"}>Today</Tab>
          <Tab to="/inventory" icon="stock" match={(path) => path.startsWith("/inventory") || path.startsWith("/stock") || path.startsWith("/pickup")}>Stock</Tab>
          <Tab to="/schedule" icon="schedule" match={(path) => path.startsWith("/schedule") || path.startsWith("/history") || path.startsWith("/time")}>Schedule</Tab>
          <Tab to="/training" icon="learn" match={(path) => path.startsWith("/training")}>Learn</Tab>
          <Tab to="/pay" icon="pay" match={(path) => path.startsWith("/pay")}>Pay</Tab>
        </div>
      </nav>
    </>
  );
}

function Tab({
  to,
  children,
  icon,
  end = false,
  match,
}: {
  to: string;
  children: string;
  icon: TabIcon;
  end?: boolean;
  match: (path: string) => boolean;
}) {
  const location = useLocation();
  const active = match(location.pathname);
  return (
    <NavLink
      to={to}
      end={end}
      className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-semibold leading-tight ${active ? "text-[var(--accent)] shadow-[inset_0_3px_0_0_var(--accent)]" : "text-stone-600"}`}
      aria-current={active ? "page" : undefined}
    >
      <TabGlyph name={icon} />
      <span>{children}</span>
    </NavLink>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
