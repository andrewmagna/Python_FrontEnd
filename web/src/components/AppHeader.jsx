import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import bannerImg from "../assets/banner.png";

export default function AppHeader() {
  const [session, setSession] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const res = await fetch("/api/session");
        const data = await res.json();
        if (!cancelled) {
          setSession(data.authenticated ? data.user : null);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
        }
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    setSession(null);
    navigate("/login", { replace: true });
  }

  if (location.pathname === "/login") {
    return (
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "4px 16px 0",
          background: "#f8fafc",
        }}
      >
        <div
          style={{
            position: "relative",
            minHeight: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={bannerImg}
            alt="MICA banner"
            style={{
              maxWidth: "min(520px, calc(100vw - 110px))",
              maxHeight: 48,
              width: "auto",
              height: "auto",
              display: "block",
              objectFit: "contain",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "4px 16px 0",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          position: "relative",
          minHeight: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={bannerImg}
          alt="MICA banner"
          style={{
            maxWidth: "min(520px, calc(100vw - 220px))",
            maxHeight: 48,
            width: "auto",
            height: "auto",
            display: "block",
            objectFit: "contain",
          }}
        />

        <div
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {session && (session.role === "admin" || session.role === "supervisor") && (
            <button
              onClick={() => navigate("/admin/users?return=grid")}
              title="Settings"
              aria-label="Settings"
              style={{
                width: 40,
                height: 40,
                minWidth: 40,
                minHeight: 40,
                padding: 0,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                lineHeight: 1,
              }}
            >
              <SettingsIcon />
            </button>
          )}
          {session && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#1f2937",
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              {session.display_name}
            </div>
          )}

          {session && (
            <button
              onClick={handleLogout}
              title="Logout"
              aria-label="Logout"
              style={{
                width: 40,
                height: 40,
                minWidth: 40,
                minHeight: 40,
                padding: 0,
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                lineHeight: 1,
              }}
            >
              <LogoutIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M12 8.75A3.25 3.25 0 1 0 12 15.25A3.25 3.25 0 1 0 12 8.75Z"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
      />
      <path
        d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a1 1 0 0 1-1 1h-1.7a1 1 0 0 1-1-1v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1 1 0 0 1-1.4 0l-1.2-1.2a1 1 0 0 1 0-1.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a1 1 0 0 1-1-1v-1.7a1 1 0 0 1 1-1h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1 1 0 0 1 0-1.4l1.2-1.2a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a1 1 0 0 1 1-1h1.7a1 1 0 0 1 1 1v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a1 1 0 0 1 1 1v1.7a1 1 0 0 1-1 1h-.2a1 1 0 0 0-.9.6Z"
        fill="none"
        stroke="#2563eb"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M10 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 8l4 4-4 4"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12h8"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}