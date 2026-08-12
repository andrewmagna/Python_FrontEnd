import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getDefaultPaths,
  normalizePaths,
  normalizeZoneIds as normalizeZones,
  zoneIdsToMap,
} from "../lib/recipes.js";

function formatPath(path, index) {
  const label = `P${index + 1}`;
  const passes = `${path.passes} pass${path.passes === 1 ? "" : "es"}`;
  const material = index < 3 ? `${path.grit} grit` : "Scotchbrite";
  return `${label}: ${passes}, ${material}, F=${path.force}`;
}

export default function AdminRecipes() {
  const { partId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const returnTarget = searchParams.get("return") || "grid";

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recipes, setRecipes] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPaths, setEditPaths] = useState(getDefaultPaths());
  const [editZones, setEditZones] = useState([]);

  async function loadRecipesPage() {
    setLoading(true);

    const statusRes = await fetch("/api/session");
    const statusData = await statusRes.json();

    if (!statusData.authenticated) {
      navigate("/login", { replace: true });
      return;
    }

    const role = statusData.user?.role;
    if (role !== "admin" && role !== "supervisor") {
      navigate("/", { replace: true });
      return;
    }

    setAuthorized(true);

    const res = await fetch(`/api/recipes/${partId}`);
    const data = res.ok ? await res.json() : [];
    setRecipes(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    loadRecipesPage();
  }, [navigate, partId, returnTarget]);

  function goBack() {
    if (returnTarget === "part") {
      navigate(`/part/${partId}`);
      return;
    }

    navigate(`/admin/editor/${partId}/1?return=${returnTarget}`);
  }

  function beginEdit(recipe) {
    setEditingId(recipe.id);
    setEditName(recipe.name || "");
    setEditDescription(recipe.description || "");
    setEditPaths(normalizePaths(recipe.paths));
    setEditZones(normalizeZones(recipe.zones));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditPaths(getDefaultPaths());
    setEditZones([]);
  }

  function updateEditPath(index, field, value) {
    setEditPaths((prev) => {
      const next = [...prev];
      const current = { ...next[index] };

      if (field === "passes") {
        current.passes = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
      } else if (field === "force") {
        current.force = Number.isFinite(Number(value)) ? Math.max(0, Math.min(20, Number(value))) : 10;
      } else if (field === "grit") {
        current.grit = [80, 120, 180].includes(Number(value)) ? Number(value) : current.grit;
      }

      next[index] = current;
      return next;
    });
  }

  function updateEditZones(rawValue) {
    const parsed = rawValue
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v >= 1 && v <= 40);

    const deduped = [...new Set(parsed)].sort((a, b) => a - b);
    setEditZones(deduped);
  }

  async function saveEdit(recipeId) {
    const name = editName.trim();

    if (!name) {
      alert("Recipe name is required");
      return;
    }

    try {
      setBusyId(recipeId);

      const res = await fetch(`/api/admin/recipes/${partId}/${recipeId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description: editDescription.trim(),
          paths: editPaths,
          zones: zoneIdsToMap(editZones),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to update recipe");
        return;
      }

      await loadRecipesPage();
      cancelEdit();
    } catch (e) {
      alert("Server error");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRecipe(recipeId) {
    const ok = window.confirm("Delete this recipe?");
    if (!ok) return;

    try {
      setBusyId(recipeId);

      const res = await fetch(`/api/admin/recipes/${partId}/${recipeId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete recipe");
        return;
      }

      if (editingId === recipeId) {
        cancelEdit();
      }

      await loadRecipesPage();
    } catch {
      alert("Server error");
    } finally {
      setBusyId(null);
    }
  }

  const recipeRows = useMemo(() => {
    return recipes.map((recipe) => ({
      ...recipe,
      normalizedPaths: normalizePaths(recipe.paths),
      normalizedZones: normalizeZones(recipe.zones),
    }));
  }, [recipes]);

  if (!authorized || loading) {
    return <div style={{ padding: 20 }}>Loading recipes...</div>;
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
      <div style={{ marginBottom: 8 }}>
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
      </div>

      <h1 style={{ marginTop: 0, marginBottom: 12 }}>
        Edit Recipes, {partId.replaceAll("_", " ")}
      </h1>

      <div
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 12,
          background: "#fff",
          overflow: "auto",
        }}
      >
        <div style={{ minWidth: 1380 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 220px 170px 420px 250px 140px",
              borderBottom: "1px solid #e5e7eb",
              alignItems: "start",
            }}
          >
            <div style={{ padding: 12 }}>Name</div>
            <div style={{ padding: 12 }}>Description</div>
            <div style={{ padding: 12 }}>Created By</div>
            <div style={{ padding: 12 }}>Paths</div>
            <div style={{ padding: 12 }}>Zones</div>
            <div style={{ padding: 12 }}>Actions</div>
          </div>

          {recipeRows.length === 0 ? (
            <div style={{ padding: 16, color: "#6b7280" }}>
              No recipes found
            </div>
          ) : (
            recipeRows.map((recipe) => {
              const isEditing = editingId === recipe.id;

              return (
                <div
                  key={recipe.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 220px 170px 420px 250px 140px",
                    borderBottom: "1px solid #e5e7eb",
                    alignItems: "start",
                  }}
                >
                  <div style={{ padding: 12 }}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{
                          width: "100%",
                          padding: 8,
                          boxSizing: "border-box",
                        }}
                      />
                    ) : (
                      <div style={{ fontWeight: 600 }}>{recipe.name}</div>
                    )}
                  </div>

                  <div style={{ padding: 12 }}>
                    {isEditing ? (
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          padding: 8,
                          boxSizing: "border-box",
                          resize: "vertical",
                          fontFamily: "Arial, sans-serif",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          color: recipe.description ? "#1f2937" : "#6b7280",
                        }}
                      >
                        {recipe.description || "No description"}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      padding: 12,
                      color: recipe.created_by ? "#1f2937" : "#6b7280",
                      fontWeight: 600,
                    }}
                  >
                    {recipe.created_by || "Unknown"}
                  </div>

                  <div style={{ padding: 12 }}>
                    {isEditing ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {editPaths.map((path, index) => (
                          <div
                            key={index}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <strong style={{ minWidth: 24 }}>
                              P{index + 1}
                            </strong>
                            <input
                              type="number"
                              min="0"
                              value={path.passes}
                              onChange={(e) =>
                                updateEditPath(
                                  index,
                                  "passes",
                                  Number(e.target.value),
                                )
                              }
                              style={{ width: 64, padding: 6 }}
                            />
                            {index < 3 ? (
                              <select
                                value={path.grit}
                                onChange={(e) =>
                                  updateEditPath(
                                    index,
                                    "grit",
                                    Number(e.target.value),
                                  )
                                }
                                style={{ width: 90, padding: 6 }}
                              >
                                <option value={80}>80 grit</option>
                                <option value={120}>120 grit</option>
                                <option value={180}>180 grit</option>
                              </select>
                            ) : (
                              <div style={{ minWidth: 90, color: "#4b5563" }}>
                                Scotchbrite
                              </div>
                            )}
                            <input
                              type="number"
                              min="0"
                              max="20"
                              step="0.1"
                              value={path.force}
                              onChange={(e) =>
                                updateEditPath(
                                  index,
                                  "force",
                                  Number(e.target.value),
                                )
                              }
                              style={{ width: 64, padding: 6 }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 4 }}>
                        {recipe.normalizedPaths.map((path, index) => (
                          <div key={index} style={{ fontSize: 13 }}>
                            {formatPath(path, index)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: 12 }}>
                    {isEditing ? (
                      <textarea
                        value={editZones.join(", ")}
                        onChange={(e) => updateEditZones(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          padding: 8,
                          boxSizing: "border-box",
                          resize: "vertical",
                          fontFamily: "Arial, sans-serif",
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                        {recipe.normalizedZones.length > 0
                          ? recipe.normalizedZones.join(", ")
                          : "No zones"}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: 12, display: "grid", gap: 8 }}>
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(recipe.id)}
                          disabled={busyId === recipe.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #2563eb",
                            background: "#2563eb",
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          {busyId === recipe.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={busyId === recipe.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 600,
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => beginEdit(recipe)}
                          disabled={busyId === recipe.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            background: "#fff",
                            fontWeight: 600,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRecipe(recipe.id)}
                          disabled={busyId === recipe.id}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #dc2626",
                            background: "#fff",
                            color: "#b91c1c",
                            fontWeight: 700,
                          }}
                        >
                          {busyId === recipe.id ? "Working..." : "Delete"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}