

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function AdminUsers() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTarget = searchParams.get("return") || "grid";

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("operator");
  const [cardBuffer, setCardBuffer] = useState("");
  const [capturedCardId, setCapturedCardId] = useState("");
  const [waitingForCard, setWaitingForCard] = useState(false);
  const [error, setError] = useState("");
  const cardInputRef = useRef(null);
  const cardDebounceRef = useRef(null);

  async function loadUsersPage() {
    setLoading(true);

    const statusRes = await fetch("/api/session");
    const statusData = await statusRes.json();

    if (!statusData.authenticated) {
      navigate("/login", { replace: true });
      return;
    }

    const sessionRole = statusData.user?.role;
    if (sessionRole !== "admin" && sessionRole !== "supervisor") {
      navigate("/", { replace: true });
      return;
    }

    setAuthorized(true);

    const res = await fetch("/api/users");
    const data = res.ok ? await res.json() : [];
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    loadUsersPage();
  }, [navigate, returnTarget]);

  useEffect(() => {
    if (showAddModal && waitingForCard) {
      cardInputRef.current?.focus();
    }
  }, [showAddModal, waitingForCard]);

  useEffect(() => {
    return () => {
      if (cardDebounceRef.current) {
        clearTimeout(cardDebounceRef.current);
      }
    };
  }, []);

  function goBack() {
    if (returnTarget === "part") {
      navigate(-1);
      return;
    }

    navigate("/", { replace: true });
  }

  function resetAddForm() {
    setDisplayName("");
    setRole("operator");
    setCardBuffer("");
    setCapturedCardId("");
    setWaitingForCard(false);
    setError("");
  }

  function beginAddUser() {
    resetAddForm();
    setShowAddModal(true);
  }

  function beginCaptureCard() {
    setError("");
    setCardBuffer("");
    setCapturedCardId("");
    setWaitingForCard(true);
    setTimeout(() => cardInputRef.current?.focus(), 0);
  }

  function onCardInputChange(e) {
    const next = e.target.value;
    setCardBuffer(next);

    if (cardDebounceRef.current) {
      clearTimeout(cardDebounceRef.current);
    }

    cardDebounceRef.current = setTimeout(() => {
      const normalized = String(next || "").trim();
      if (!normalized) {
        return;
      }
      setCapturedCardId(normalized);
      setWaitingForCard(false);
      setCardBuffer("");
    }, 180);
  }

  async function addUser() {
    const trimmedName = displayName.trim();

    if (!trimmedName) {
      setError("Display name is required");
      return;
    }

    if (!capturedCardId) {
      setError("Tap a card before saving");
      return;
    }

    try {
      setAddBusy(true);
      setError("");

      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          display_name: trimmedName,
          role,
          card_id: capturedCardId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Failed to create user");
        return;
      }

      resetAddForm();
      setShowAddModal(false);
      await loadUsersPage();
    } catch {
      setError("Server error");
    } finally {
      setAddBusy(false);
    }
  }

  async function deleteUser(userId) {
    const ok = window.confirm("Delete this user?");
    if (!ok) return;

    try {
      setBusyId(userId);

      const res = await fetch(`/api/users/${userId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete user");
        return;
      }

      await loadUsersPage();
    } catch {
      alert("Server error");
    } finally {
      setBusyId(null);
    }
  }

  const userRows = useMemo(() => {
    return [...users].sort((a, b) => {
      const left = String(a.display_name || "").toLowerCase();
      const right = String(b.display_name || "").toLowerCase();
      return left.localeCompare(right);
    });
  }, [users]);

  if (!authorized || loading) {
    return <div style={{ padding: 20 }}>Loading users...</div>;
  }

  return (
    <div
      style={{
        padding: "8px 10px 10px",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <button
          onClick={goBack}
          style={{
            background: "none",
            border: "none",
            color: "#2563eb",
            cursor: "pointer",
            padding: 0,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          ← Back
        </button>

        <button
          onClick={beginAddUser}
          style={{
            padding: "9px 14px",
            borderRadius: 10,
            border: "1px solid #2563eb",
            background: "#2563eb",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Add User
        </button>
      </div>

      <h1 style={{ marginTop: 0, marginBottom: 12 }}>Manage Users</h1>

      <div
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 12,
          background: "#fff",
          overflow: "auto",
        }}
      >
        <div style={{ minWidth: 940 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "220px 140px 240px 220px 120px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <div style={{ padding: 12 }}>Display Name</div>
            <div style={{ padding: 12 }}>Role</div>
            <div style={{ padding: 12 }}>Card ID</div>
            <div style={{ padding: 12 }}>Created At</div>
            <div style={{ padding: 12 }}>Actions</div>
          </div>

          {userRows.length === 0 ? (
            <div style={{ padding: 16, color: "#6b7280" }}>No users found</div>
          ) : (
            userRows.map((user) => (
              <div
                key={user.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "220px 140px 240px 220px 120px",
                  borderBottom: "1px solid #e5e7eb",
                  alignItems: "start",
                }}
              >
                <div style={{ padding: 12, fontWeight: 600 }}>{user.display_name || "-"}</div>
                <div style={{ padding: 12, textTransform: "capitalize" }}>{user.role || "-"}</div>
                <div style={{ padding: 12, fontFamily: "monospace", fontSize: 13 }}>{user.card_id || "-"}</div>
                <div style={{ padding: 12, fontSize: 13, color: "#4b5563" }}>{user.created_at || "-"}</div>
                <div style={{ padding: 12 }}>
                  <button
                    onClick={() => deleteUser(user.id)}
                    disabled={busyId === user.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #dc2626",
                      background: "#fff",
                      color: "#b91c1c",
                      fontWeight: 700,
                      cursor: busyId === user.id ? "not-allowed" : "pointer",
                    }}
                  >
                    {busyId === user.id ? "Working..." : "Delete"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => {
            if (addBusy) return;
            setShowAddModal(false);
            resetAddForm();
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: 18,
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)",
              padding: "22px 20px",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
              Add User
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter display name"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 10,
                    boxSizing: "border-box",
                    fontSize: 14,
                  }}
                  disabled={addBusy}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 10,
                    boxSizing: "border-box",
                    fontSize: 14,
                    background: "#fff",
                  }}
                  disabled={addBusy}
                >
                  <option value="operator">Operator</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#374151",
                    marginBottom: 6,
                  }}
                >
                  RFID Card
                </label>

                <div style={{ display: "grid", gap: 8 }}>
                  <button
                    onClick={beginCaptureCard}
                    disabled={addBusy}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #2563eb",
                      background: waitingForCard ? "#dbeafe" : "#fff",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      cursor: addBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {waitingForCard ? "Waiting for card tap..." : "Tap Card"}
                  </button>

                  <input
                    ref={cardInputRef}
                    type="text"
                    value={waitingForCard ? cardBuffer : capturedCardId}
                    onChange={onCardInputChange}
                    placeholder={waitingForCard ? "Tap card now" : "No card captured yet"}
                    readOnly={!waitingForCard}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: 10,
                      boxSizing: "border-box",
                      fontSize: 14,
                      fontFamily: "monospace",
                      background: waitingForCard ? "#fff" : "#f9fafb",
                    }}
                  />
                </div>
              </div>
            </div>

            {error && (
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
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 18,
              }}
            >
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetAddForm();
                }}
                disabled={addBusy}
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  fontWeight: 600,
                  cursor: addBusy ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={addUser}
                disabled={addBusy}
                style={{
                  padding: "9px 14px",
                  borderRadius: 10,
                  border: "1px solid #2563eb",
                  background: addBusy ? "#dbeafe" : "#2563eb",
                  color: addBusy ? "#6b7280" : "#fff",
                  fontWeight: 700,
                  cursor: addBusy ? "not-allowed" : "pointer",
                }}
              >
                {addBusy ? "Saving..." : "Save User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}