import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const next = searchParams.get("next") || "/";

  async function login() {
    setErr("");
    setBusy(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.detail || "Login failed");
        return;
      }

      navigate(next, { replace: true });
    } catch {
      setErr("Login failed");
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    navigate(-1);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && password && !busy) {
      login();
    }
    if (e.key === "Escape") {
      closeModal();
    }
  }

  return (
    <div
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.38)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 1000,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        onClick={closeModal}
        style={{
          position: "absolute",
          inset: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          background: "#ffffff",
          border: "1px solid #d1d5db",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          padding: 24,
          zIndex: 1,
        }}
      >
        <button
          onClick={closeModal}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 34,
            height: 34,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#374151",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#1f2937",
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            Admin Login
          </div>

          <div
            style={{
              fontSize: 14,
              color: "#6b7280",
              lineHeight: 1.5,
            }}
          >
            Enter the admin password to continue.
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            type="password"
            value={password}
            placeholder="Admin password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: "12px 14px",
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 12,
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
            }}
          />

          <button
            onClick={login}
            disabled={busy || !password}
            style={{
              padding: "12px 14px",
              width: "100%",
              border: "1px solid #2563eb",
              borderRadius: 12,
              background: busy || !password ? "#dbeafe" : "#2563eb",
              color: busy || !password ? "#6b7280" : "#ffffff",
              fontSize: 14,
              fontWeight: 700,
              cursor: busy || !password ? "not-allowed" : "pointer",
              opacity: busy || !password ? 0.7 : 1,
            }}
          >
            {busy ? "Logging in..." : "Login"}
          </button>
        </div>

        {err && (
          <div
            style={{
              marginTop: 14,
              color: "#b91c1c",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {err}
          </div>
        )}
      </div>
    </div>
  );
}