import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import bannerImg from "../assets/banner.png";

export default function AppHeader() {
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      try {
        const res = await fetch("/api/admin/status");
        const data = await res.json();
        if (!cancelled) {
          setIsAdmin(!!data.admin);
        }
      } catch {
        if (!cancelled) {
          setIsAdmin(false);
        }
      }
    }

    checkAdmin();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  async function handleAdminClick() {
    if (isAdmin) {
      try {
        await fetch("/api/admin/logout", { method: "POST" });
        setIsAdmin(false);
      } catch {
        alert("Logout failed");
      }
      return;
    }

    navigate("/admin/login?next=/", {
      state: { backgroundLocation: location },
    });
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
            maxWidth: "min(520px, calc(100vw - 110px))",
            maxHeight: 48,
            width: "auto",
            height: "auto",
            display: "block",
            objectFit: "contain",
          }}
        />

        <button
          onClick={handleAdminClick}
          title={isAdmin ? "Admin logout" : "Admin login"}
          aria-label={isAdmin ? "Admin logout" : "Admin login"}
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 40,
            height: 40,
            minWidth: 40,
            minHeight: 40,
            padding: 0,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: isAdmin ? "#eff6ff" : "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#93c5fd";
            e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
            e.currentTarget.style.transform =
              "translateY(-50%) translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#e5e7eb";
            e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
            e.currentTarget.style.transform = "translateY(-50%)";
          }}
        >
          {isAdmin ? <LogoutIcon /> : <LoginIcon />}
        </button>
      </div>
    </div>
  );
}

function LoginIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <circle cx="12" cy="8" r="4" fill="#374151" />
      <path
        d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"
        fill="none"
        stroke="#374151"
        strokeWidth="2"
        strokeLinecap="round"
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