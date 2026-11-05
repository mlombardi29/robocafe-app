import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { inPractice } from "./lib/access";
import {
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
import { HomePage } from "./screens/Home";
import { ServicePage } from "./screens/Service";
import { SetPinPage } from "./screens/SetPin";
import { SignInPage } from "./screens/SignIn";
import { TimePage } from "./screens/Time";
import { TrainingHome, TrainingModelPage } from "./screens/Training";
import { PracticeBanner } from "./ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const PreviewApp = import.meta.env.DEV ? lazy(() => import("./preview/PreviewApp")) : null;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {PreviewApp ? <Route path="/__preview/:screen" element={<Suspense fallback={null}><PreviewApp /></Suspense>} /> : null}
            <Route path="/signin" element={<SignInPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/set-pin" element={<SetPinPage />} />
              <Route element={<Shell />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/service/:siteId" element={<ServicePage />} />
                <Route path="/time" element={<TimePage />} />
                <Route path="/training" element={<TrainingHome />} />
                <Route path="/training/:code" element={<TrainingModelPage />} />
                <Route path="/admin" element={<AdminOnly><AdminHome /></AdminOnly>} />
                <Route path="/admin/people/new" element={<AdminOnly><AddPersonPage /></AdminOnly>} />
                <Route path="/admin/people" element={<AdminOnly><PeoplePage /></AdminOnly>} />
                <Route path="/admin/corrections" element={<AdminOnly><CorrectionsPage /></AdminOnly>} />
                <Route path="/admin/trainees" element={<AdminOnly><TraineesPage /></AdminOnly>} />
                <Route path="/admin/shows" element={<AdminOnly><ShowsPage /></AdminOnly>} />
                <Route path="/admin/checklist" element={<AdminOnly><ChecklistPage /></AdminOnly>} />
                <Route path="/admin/practice" element={<AdminOnly><PracticeResetPage /></AdminOnly>} />
                <Route path="/admin/offboarding" element={<AdminOnly><OffboardingPage /></AdminOnly>} />
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
  return (
    <>
      <div className="mx-auto w-full max-w-[480px] px-4 pt-3">
        <PracticeBanner show={practice} />
      </div>
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-[var(--bg)]">
        <div className={`mx-auto grid max-w-[480px] ${admin ? "grid-cols-4" : "grid-cols-3"} text-center text-sm font-semibold`}>
          <Tab to="/">Home</Tab>
          <Tab to="/training">Training</Tab>
          <Tab to="/time">My time</Tab>
          {admin ? <Tab to="/admin">Admin</Tab> : null}
        </div>
      </nav>
    </>
  );
}

function Tab({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center justify-center">
      {children}
    </Link>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  if (profile?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
