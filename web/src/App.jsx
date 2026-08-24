import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import PartsGrid from "./pages/PartsGrid.jsx";
import PartPage from "./pages/PartPage.jsx";
import AdminLogin from "./pages/AdminLogin.jsx";
import AdminEditor from "./pages/AdminEditor.jsx";
import AppHeader from "./components/AppHeader.jsx";
import AdminRecipes from "./pages/AdminRecipes.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import AdminParts from "./pages/AdminParts.jsx";
import SummaryPage from "./pages/SummaryPage.jsx";
import { SessionContext } from "./SessionContext.jsx";

function ProtectedRoute({ session, children }) {
  if (!session?.authenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState({ loading: true, authenticated: false, user: null, inactivity_timeout_minutes: 15 });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const res = await fetch("/api/session");
        const data = await res.json();
        if (!cancelled) {
          setSession({
            loading: false,
            authenticated: !!data.authenticated,
            user: data.user || null,
            inactivity_timeout_minutes: data.inactivity_timeout_minutes ?? 15,
          });
        }
      } catch {
        if (!cancelled) {
          setSession({ loading: false, authenticated: false, user: null });
        }
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    // The summary window is a passive display — never trigger inactivity logout there.
    if (!session.authenticated || location.pathname === "/summary") return;

    let timeoutId;
    const timeoutMs = (session.inactivity_timeout_minutes ?? 15) * 60 * 1000;

    async function forceLogout() {
      try {
        await fetch("/api/logout", { method: "POST" });
      } catch {}
      setSession({ loading: false, authenticated: false, user: null });
      navigate("/login", { replace: true });
    }

    function resetTimer() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(forceLogout, timeoutMs);
    }

    resetTimer();

    const events = ["mousemove", "mousedown", "keydown", "touchstart"];
    for (const eventName of events) {
      window.addEventListener(eventName, resetTimer);
    }

    return () => {
      clearTimeout(timeoutId);
      for (const eventName of events) {
        window.removeEventListener(eventName, resetTimer);
      }
    };
  }, [session.authenticated, location.pathname, navigate]);

  if (session.loading) {
    return null;
  }

  return (
    <SessionContext.Provider value={{ session, setSession }}>
      <div
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
          width: "100%",
        }}
      >
        <AppHeader />

        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <Routes>
            <Route
              path="/login"
              element={
                session.authenticated ? <Navigate to="/" replace /> : <AdminLogin />
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute session={session}>
                  <PartsGrid />
                </ProtectedRoute>
              }
            />
            <Route
              path="/part/:partId"
              element={
                <ProtectedRoute session={session}>
                  <PartPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/editor/:partId"
              element={
                <ProtectedRoute session={session}>
                  <AdminEditor />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/recipes/:partId"
              element={
                <ProtectedRoute session={session}>
                  <AdminRecipes />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute session={session}>
                  <AdminUsers />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/parts"
              element={
                <ProtectedRoute session={session}>
                  <AdminParts />
                </ProtectedRoute>
              }
            />
            <Route
              path="/summary"
              element={<SummaryPage />}
            />
            <Route path="*" element={<Navigate to={session.authenticated ? "/" : "/login"} replace />} />
          </Routes>
        </div>
      </div>
    </SessionContext.Provider>
  );
}