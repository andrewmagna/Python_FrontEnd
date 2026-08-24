import { useLocation, useNavigate } from "react-router-dom";
import bannerImg from "../assets/banner.png";
import { useSession, useSetSession } from "../SessionContext.jsx";

export default function AppHeader() {
  const sessionData = useSession();
  const session = sessionData?.authenticated ? sessionData.user : null;
  const setSession = useSetSession();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    setSession({ loading: false, authenticated: false, user: null });
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
          {session && (
            <button
              onClick={() => window.open("/summary", "_blank")}
              title="Summary Display"
              aria-label="Summary Display"
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
              <MonitorIcon />
            </button>
          )}
          {session && (session.role === "admin" || session.role === "supervisor") && (
            <button
              onClick={() => navigate("/admin/users?return=grid")}
              title="Manage Users"
              aria-label="Manage Users"
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
              <PersonIcon />
            </button>
          )}
          {session && (session.role === "admin" || session.role === "supervisor") && (
            <button
              onClick={() => navigate("/admin/parts?return=grid")}
              title="Manage Parts"
              aria-label="Manage Parts"
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
              <DoorIcon />
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

function MonitorIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect
        x="2" y="3" width="20" height="14" rx="2"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 21h8M12 17v4"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle
        cx="12" cy="8" r="4"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 20c0-3.6 3.6-5.5 8-5.5s8 1.9 8 5.5"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DoorIcon() {
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
        d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 21h18"
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="15" cy="12" r="1.2" fill="#2563eb" stroke="none" />
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