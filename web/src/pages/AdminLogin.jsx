import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rfidBuffer, setRfidBuffer] = useState("");
  const [activeTab, setActiveTab] = useState("rfid");
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const bufferTimeoutRef = useRef(null);

  useEffect(() => {
    if (activeTab === "rfid" && !busy) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }

    return () => {
      if (bufferTimeoutRef.current) {
        clearTimeout(bufferTimeoutRef.current);
      }
    };
  }, [activeTab, busy]);

  async function loginAdmin() {
    setErr("");
    setBusy(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.detail || "Login failed");
        return;
      }

      navigate("/", { replace: true });
    } catch {
      setErr("Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function loginRFID(cardId) {
    const normalized = String(cardId || "").trim();
    if (!normalized) return;

    setErr("");
    setBusy(true);

    try {
      const res = await fetch("/api/login/rfid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: normalized }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.detail || "RFID login failed");
        return;
      }

      navigate("/", { replace: true });
    } catch {
      setErr("RFID login failed");
    } finally {
      setBusy(false);
      setRfidBuffer("");
      inputRef.current?.focus();
    }
  }

  function onAdminKeyDown(e) {
    if (e.key === "Enter" && username && password && !busy) {
      loginAdmin();
    }
  }

  function onRFIDChange(e) {
    const next = e.target.value;
    setRfidBuffer(next);

    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
    }

    bufferTimeoutRef.current = setTimeout(() => {
      loginRFID(next);
    }, 180);
  }

  function switchTab(tab) {
    setErr("");
    setActiveTab(tab);
    if (tab === "rfid") {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  const scanStatusText = useMemo(() => {
    if (busy) return "Signing in...";
    if (rfidBuffer.trim()) return "Card detected";
    return "";
  }, [busy, rfidBuffer]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <style>{`
        .wifi-bar {
          opacity: 0.2;
          animation: wifiBlink 4.2s infinite;
        }

        .wifi-bar.bar-1 {
          animation-delay: 0s;
        }

        .wifi-bar.bar-2 {
          animation-delay: 0.2s;
        }

        .wifi-bar.bar-3 {
          animation-delay: 0.4s;
        }

        .wifi-dot {
          opacity: 0.2;
          animation: wifiBlink 4.2s infinite;
          animation-delay: 0.6s;
        }

        @keyframes wifiBlink {
          0%, 100% {
            opacity: 0.2;
          }
          25% {
            opacity: 1;
          }
        }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          border: "1px solid #d1d5db",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,0.12)",
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#1f2937", marginBottom: 8 }}>
            Login
          </div>
          <div style={{ fontSize: 14, color: "#6b7280" }}>
            Tap your card to sign in, or use the admin tab.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => switchTab("rfid")}
            style={{
              padding: "11px",
              borderRadius: 12,
              border: activeTab === "rfid" ? "1px solid #2563eb" : "1px solid #d1d5db",
              background: activeTab === "rfid" ? "#eff6ff" : "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Login
          </button>
          <button
            onClick={() => switchTab("admin")}
            style={{
              padding: "11px",
              borderRadius: 12,
              border: activeTab === "admin" ? "1px solid #2563eb" : "#d1d5db",
              background: activeTab === "admin" ? "#eff6ff" : "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Admin
          </button>
        </div>

        {activeTab === "rfid" ? (
          <div style={{ border: "1px solid #d1d5db", borderRadius: 14, padding: 18, background: "#f9fafb" }}>
            <input
              ref={inputRef}
              type="text"
              value={rfidBuffer}
              onChange={onRFIDChange}
              autoFocus
              style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
            />

            <div
              onClick={() => inputRef.current?.focus()}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 16,
                padding: 20,
                display: "grid",
                justifyItems: "center",
                gap: 10,
                cursor: "text",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  style={{ display: "block" }}
                >
                  <path
                    className="wifi-bar bar-1"
                    d="M2 8c5-5 15-5 20 0"
                    stroke="#2563eb"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    className="wifi-bar bar-2"
                    d="M5 11c3.5-3.5 10.5-3.5 14 0"
                    stroke="#2563eb"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    className="wifi-bar bar-3"
                    d="M8.5 14.5c2-2 5-2 7 0"
                    stroke="#1d4ed8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <circle className="wifi-dot" cx="12" cy="18" r="1.5" fill="#1d4ed8" />
                </svg>
              </div>
              <div style={{ fontWeight: 700 }}>{scanStatusText}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Waiting for card</div>
            </div>
          </div>
        ) : (
          <div style={{ border: "1px solid #d1d5db", borderRadius: 14, padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Admin Login</div>
            <div style={{ display: "grid", gap: 10 }}>
              <input
                type="text"
                value={username}
                placeholder="Admin username"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={onAdminKeyDown}
                style={{ padding: "12px", borderRadius: 12, border: "1px solid #d1d5db" }}
              />
              <input
                type="password"
                value={password}
                placeholder="Admin password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={onAdminKeyDown}
                style={{ padding: "12px", borderRadius: 12, border: "1px solid #d1d5db" }}
              />
              <button
                onClick={loginAdmin}
                disabled={busy || !username || !password}
                style={{ padding: "12px", borderRadius: 12, background: "#2563eb", color: "#fff" }}
              >
                {busy ? "Logging in..." : "Admin Login"}
              </button>
            </div>
          </div>
        )}

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