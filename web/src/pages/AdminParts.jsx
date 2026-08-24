import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function AdminParts() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTarget = searchParams.get("return") || "grid";

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [parts, setParts] = useState([]);
  const [idDrafts, setIdDrafts] = useState({});
  const [busyPart, setBusyPart] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const [showAddModal, setShowAddModal] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [overlayFile, setOverlayFile] = useState(null);
  const [addError, setAddError] = useState("");
  const imageInputRef = useRef(null);
  const overlayInputRef = useRef(null);

  async function loadPartsPage() {
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

    const res = await fetch("/api/admin/parts");
    const data = res.ok ? await res.json() : [];
    const list = Array.isArray(data) ? data : [];
    setParts(list);
    setIdDrafts(Object.fromEntries(list.map((p) => [p.part_id, String(p.numeric_id ?? "")])));
    setRowErrors({});
    setLoading(false);
  }

  useEffect(() => {
    loadPartsPage();
  }, [navigate, returnTarget]);

  function goBack() {
    if (returnTarget === "part") {
      navigate(-1);
      return;
    }

    navigate("/", { replace: true });
  }

  async function commitId(part) {
    const raw = String(idDrafts[part.part_id] ?? "").trim();
    const numericId = Number(raw);

    if (raw === "" || !Number.isInteger(numericId)) {
      setRowErrors((prev) => ({ ...prev, [part.part_id]: "Part ID must be an integer" }));
      return;
    }
    if (numericId < 1 || numericId > 32767) {
      setRowErrors((prev) => ({ ...prev, [part.part_id]: "Part ID must be between 1 and 32767" }));
      return;
    }
    if (numericId === part.numeric_id) {
      setRowErrors((prev) => ({ ...prev, [part.part_id]: "" }));
      return;
    }

    try {
      setBusyPart(part.part_id);
      setRowErrors((prev) => ({ ...prev, [part.part_id]: "" }));

      const res = await fetch(`/api/admin/parts/${encodeURIComponent(part.part_id)}/id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeric_id: numericId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRowErrors((prev) => ({
          ...prev,
          [part.part_id]: err.detail || "Failed to update part ID",
        }));
        setIdDrafts((prev) => ({ ...prev, [part.part_id]: String(part.numeric_id ?? "") }));
        return;
      }

      await loadPartsPage();
    } catch {
      setRowErrors((prev) => ({ ...prev, [part.part_id]: "Server error" }));
    } finally {
      setBusyPart(null);
    }
  }

  async function removePart(part) {
    const ok = window.confirm(
      `Remove part "${part.display_name}"?\n\nIts zones, recipes, and saved state will be archived to _removed and its Part ID will be freed.`
    );
    if (!ok) return;

    try {
      setBusyPart(part.part_id);

      const res = await fetch(`/api/admin/parts/${encodeURIComponent(part.part_id)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to remove part");
        return;
      }

      await loadPartsPage();
    } catch {
      alert("Server error");
    } finally {
      setBusyPart(null);
    }
  }

  function resetAddForm() {
    setNewName("");
    setImageFile(null);
    setOverlayFile(null);
    setAddError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (overlayInputRef.current) overlayInputRef.current.value = "";
  }

  function beginAddPart() {
    resetAddForm();
    setShowAddModal(true);
  }

  async function addPart() {
    const trimmedName = newName.trim();

    if (!trimmedName) {
      setAddError("Part name is required");
      return;
    }
    if (!imageFile) {
      setAddError("Choose an image before saving");
      return;
    }

    try {
      setAddBusy(true);
      setAddError("");

      const form = new FormData();
      form.append("name", trimmedName);
      form.append("image", imageFile);
      if (overlayFile) {
        form.append("overlay", overlayFile);
      }

      const res = await fetch("/api/admin/parts", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAddError(err.detail || "Failed to add part");
        return;
      }

      resetAddForm();
      setShowAddModal(false);
      await loadPartsPage();
    } catch {
      setAddError("Server error");
    } finally {
      setAddBusy(false);
    }
  }

  if (!authorized || loading) {
    return <div style={{ padding: 20 }}>Loading parts...</div>;
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
          onClick={beginAddPart}
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
          Add Part
        </button>
      </div>

      <h1 style={{ marginTop: 0, marginBottom: 12 }}>Manage Parts</h1>

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
              gridTemplateColumns: "110px 240px 240px 220px 120px",
              borderBottom: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <div style={{ padding: 12 }}>Image</div>
            <div style={{ padding: 12 }}>Display Name</div>
            <div style={{ padding: 12 }}>Folder Name</div>
            <div style={{ padding: 12 }}>Part ID</div>
            <div style={{ padding: 12 }}>Actions</div>
          </div>

          {parts.length === 0 ? (
            <div style={{ padding: 16, color: "#6b7280" }}>No parts found</div>
          ) : (
            parts.map((part) => (
              <div
                key={part.part_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 240px 240px 220px 120px",
                  borderBottom: "1px solid #e5e7eb",
                  alignItems: "center",
                }}
              >
                <div style={{ padding: 12 }}>
                  <img
                    src={part.image_url}
                    alt={part.display_name}
                    style={{
                      width: 72,
                      height: 48,
                      objectFit: "contain",
                      background: "#f3f4f6",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      display: "block",
                    }}
                  />
                </div>
                <div style={{ padding: 12, fontWeight: 600 }}>{part.display_name || "-"}</div>
                <div style={{ padding: 12, fontFamily: "monospace", fontSize: 13 }}>{part.part_id}</div>
                <div style={{ padding: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="number"
                      min={1}
                      max={32767}
                      step={1}
                      value={idDrafts[part.part_id] ?? ""}
                      onChange={(e) =>
                        setIdDrafts((prev) => ({ ...prev, [part.part_id]: e.target.value }))
                      }
                      onBlur={() => commitId(part)}
                      disabled={busyPart === part.part_id}
                      style={{
                        width: 90,
                        padding: "8px 10px",
                        border: "1px solid #d1d5db",
                        borderRadius: 8,
                        fontSize: 14,
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      onClick={() => commitId(part)}
                      disabled={busyPart === part.part_id}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #2563eb",
                        background: "#fff",
                        color: "#1d4ed8",
                        fontWeight: 700,
                        cursor: busyPart === part.part_id ? "not-allowed" : "pointer",
                      }}
                    >
                      Save
                    </button>
                  </div>
                  {rowErrors[part.part_id] ? (
                    <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 12, fontWeight: 600 }}>
                      {rowErrors[part.part_id]}
                    </div>
                  ) : null}
                </div>
                <div style={{ padding: 12 }}>
                  <button
                    onClick={() => removePart(part)}
                    disabled={busyPart === part.part_id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #dc2626",
                      background: "#fff",
                      color: "#b91c1c",
                      fontWeight: 700,
                      cursor: busyPart === part.part_id ? "not-allowed" : "pointer",
                    }}
                  >
                    {busyPart === part.part_id ? "Working..." : "Remove"}
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
              Add Part
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
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter part name"
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
                  Image
                </label>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  disabled={addBusy}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #2563eb",
                    background: "#fff",
                    color: "#1d4ed8",
                    fontWeight: 700,
                    cursor: addBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Choose Image
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                />
                <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563", fontFamily: "monospace" }}>
                  {imageFile ? imageFile.name : "No file chosen"}
                </div>
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
                  Overlay (optional)
                </label>
                <button
                  onClick={() => overlayInputRef.current?.click()}
                  disabled={addBusy}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    color: "#374151",
                    fontWeight: 700,
                    cursor: addBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Choose Overlay (optional)
                </button>
                <input
                  ref={overlayInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => setOverlayFile(e.target.files?.[0] || null)}
                />
                <div style={{ marginTop: 6, fontSize: 13, color: "#4b5563", fontFamily: "monospace" }}>
                  {overlayFile ? overlayFile.name : "No file chosen"}
                </div>
              </div>
            </div>

            {addError && (
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
                {addError}
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
                onClick={addPart}
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
                {addBusy ? "Uploading..." : "Save Part"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
