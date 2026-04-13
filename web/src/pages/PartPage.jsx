import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";

const ORIENTATION_LABELS = {
  1: "0°",
  2: "90°",
  3: "180°",
  4: "270°",
};

const HEADER_HEIGHT = 96;

function getDefaultPaths() {
  return [
    { passes: 0, grit: 80, force: 10 },
    { passes: 0, grit: 120, force: 10 },
    { passes: 0, grit: 180, force: 10 },
    { passes: 0, force: 10 },
  ];
}

export default function PartPage() {
  const { partId } = useParams();

  const [part, setPart] = useState(null);
  const [zoneState, setZoneState] = useState({});
  const [hoveredZone, setHoveredZone] = useState(null);
  const [opcConnected, setOpcConnected] = useState(false);
  const [opcStatusLoaded, setOpcStatusLoaded] = useState(false);
  const [autoApplyBusy, setAutoApplyBusy] = useState(false);
  const [tableOrientation, setTableOrientation] = useState(null);
  const [tableOrientationDegrees, setTableOrientationDegrees] = useState(null);
  const [debugOrientationOverride, setDebugOrientationOverride] =
    useState("live");
  const [isNarrow, setIsNarrow] = useState(false);

  const [forceReading, setForceReading] = useState(null);

  const [paths, setPaths] = useState(() => getDefaultPaths());

  const [recipes, setRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false);
  const [saveRecipeBusy, setSaveRecipeBusy] = useState(false);
  const [loadRecipeBusy, setLoadRecipeBusy] = useState(false);
  const [recipeNameInput, setRecipeNameInput] = useState("");
  const [recipeDescriptionInput, setRecipeDescriptionInput] = useState("");

  const writeTimeoutRef = useRef(null);
  const saveLastStateTimeoutRef = useRef(null);
  const hasLoadedLastStateRef = useRef(false);
  const isRestoringLastStateRef = useRef(false);

  async function refreshRecipes() {
    try {
      setRecipesLoading(true);
      const res = await fetch(`/api/recipes/${partId}`);

      if (!res.ok) {
        setRecipes([]);
        return;
      }

      const data = await res.json();
      setRecipes(Array.isArray(data) ? data : []);
    } catch {
      setRecipes([]);
    } finally {
      setRecipesLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (writeTimeoutRef.current) {
        clearTimeout(writeTimeoutRef.current);
      }
      if (saveLastStateTimeoutRef.current) {
        clearTimeout(saveLastStateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/parts/${partId}`);
      const data = await res.json();

      setPart(data);

      const z = {};
      for (let i = 1; i <= 40; i++) z[i] = false;
      setZoneState(z);
      setSelectedRecipeId(null);
      hasLoadedLastStateRef.current = false;
      isRestoringLastStateRef.current = false;
      setOpcStatusLoaded(false);
    }

    load();
  }, [partId]);

  useEffect(() => {
    function updateLayoutMode() {
      setIsNarrow(window.innerWidth < 1150);
    }

    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);
    return () => window.removeEventListener("resize", updateLayoutMode);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/opc/status");
        const data = await res.json();

        if (!cancelled) {
          setOpcConnected(!!data.connected);
          setTableOrientation(
            [1, 2, 3, 4].includes(data.table_orientation)
              ? data.table_orientation
              : null,
          );
          setTableOrientationDegrees(
            typeof data.table_orientation_degrees === "number"
              ? data.table_orientation_degrees
              : null,
          );
          setOpcStatusLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setOpcConnected(false);
          setTableOrientation(null);
          setTableOrientationDegrees(null);
          setOpcStatusLoaded(true);
        }
      }
    }

    poll();
    const t = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollForce() {
      try {
        const res = await fetch(`/api/opc/force?t=${Date.now()}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setForceReading(null);
          return;
        }

        const data = await res.json();

        if (!cancelled) {
          setForceReading(typeof data.value === "number" ? data.value : null);
        }
      } catch {
        if (!cancelled) setForceReading(null);
      }
    }

    pollForce();
    const t = setInterval(pollForce, 500);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const effectiveOrientation =
    debugOrientationOverride === "live"
      ? tableOrientation
      : Number(debugOrientationOverride);

  useEffect(() => {
    refreshRecipes();
  }, [partId]);


  useEffect(() => {
    if (!part) return;
    if (!opcStatusLoaded) return;
    if (hasLoadedLastStateRef.current) return;

    let cancelled = false;

    async function restoreLastState() {
      isRestoringLastStateRef.current = true;
      hasLoadedLastStateRef.current = true;

      try {
        if (!opcConnected) {
          if (!cancelled) {
            setPaths(getDefaultPaths());
            setZoneState(createEmptyZoneState());
            setSelectedRecipeId(null);
          }
          return;
        }

        const res = await fetch(`/api/parts/${partId}/last-state`);
        if (!res.ok) {
          if (!cancelled) {
            setPaths(getDefaultPaths());
            setZoneState(createEmptyZoneState());
            setSelectedRecipeId(null);
          }
          return;
        }

        const data = await res.json();
        if (cancelled || !data || typeof data !== "object") {
          return;
        }

        const nextPaths =
          Array.isArray(data.paths) && data.paths.length > 0
            ? normalizeRecipePaths(data.paths)
            : getDefaultPaths();

        const savedOrientation = [1, 2, 3, 4].includes(data.orientation)
          ? data.orientation
          : null;
        const orientationMatches =
          savedOrientation !== null &&
          effectiveOrientation !== null &&
          savedOrientation === effectiveOrientation;

        const nextZones = orientationMatches
          ? normalizeRecipeZones(data.zones)
          : createEmptyZoneState();

        const parsedSelectedRecipeId = Number(data.selected_recipe_id);
        const nextSelectedRecipeId =
          orientationMatches && Number.isInteger(parsedSelectedRecipeId)
            ? parsedSelectedRecipeId
            : null;

        if (!cancelled) {
          setPaths(nextPaths);
          setZoneState(nextZones);
          setSelectedRecipeId(nextSelectedRecipeId);
        }

        if (debugOrientationOverride === "live" && opcConnected) {
          writePathsToOPC(nextPaths);
          await pushZoneState(nextZones);
        }
      } catch {
        if (!cancelled) {
          setPaths(getDefaultPaths());
          setZoneState(createEmptyZoneState());
          setSelectedRecipeId(null);
        }
      } finally {
        isRestoringLastStateRef.current = false;
      }
    }

    restoreLastState();

    return () => {
      cancelled = true;
    };
  }, [
    partId,
    part,
    effectiveOrientation,
    opcConnected,
    opcStatusLoaded,
    debugOrientationOverride,
  ]);

  useEffect(() => {
    if (!partId) return;
    if (!hasLoadedLastStateRef.current) return;
    if (isRestoringLastStateRef.current) return;

    persistLastState(buildLastStatePayload());
  }, [partId, zoneState, paths, selectedRecipeId, effectiveOrientation]);

  useEffect(() => {
    function handleBeforeUnload() {
      flushLastState({ keepalive: true });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushLastState({ keepalive: true });
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [partId, zoneState, paths, selectedRecipeId, effectiveOrientation]);

  function writePathsToOPC(updatedPaths) {
    // Do not attempt writes if OPC is disconnected
    if (!opcConnected) {
      return;
    }
    clearTimeout(writeTimeoutRef.current);

    writeTimeoutRef.current = setTimeout(() => {
      fetch("/api/opc/write-paths", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paths: updatedPaths }),
      });
    }, 100);
  }

  function updatePath(index, field, value) {
    let nextValue = value;

    if (field === "passes") {
      nextValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    }

    if (field === "force") {
      nextValue = Number.isFinite(value)
        ? Math.max(0, Math.min(20, value))
        : 10;
    }

    setPaths((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: nextValue };

      writePathsToOPC(next);
      persistLastState(
        buildLastStatePayload({
          paths: next,
          zones: zoneState,
          selected_recipe_id: selectedRecipeId,
        }),
      );
      return next;
    });
  }

  function createEmptyZoneState() {
    const next = {};
    for (let i = 1; i <= 40; i++) next[i] = false;
    return next;
  }

  function normalizeRecipePaths(rawPaths) {
    const defaults = getDefaultPaths();

    if (!Array.isArray(rawPaths)) {
      return defaults;
    }

    return defaults.map((defaultPath, index) => {
      const raw =
        rawPaths[index] && typeof rawPaths[index] === "object"
          ? rawPaths[index]
          : {};

      const next = {
        ...defaultPath,
        passes: Number.isFinite(Number(raw.passes))
          ? Math.max(0, Math.trunc(Number(raw.passes)))
          : defaultPath.passes,
        force: Number.isFinite(Number(raw.force))
          ? Math.max(0, Math.min(20, Number(raw.force)))
          : defaultPath.force,
      };

      if (index < 3) {
        const grit = Number(raw.grit);
        next.grit = [80, 120, 180].includes(grit) ? grit : defaultPath.grit;
      }

      return next;
    });
  }

  function normalizeRecipeZones(rawZones) {
    const next = createEmptyZoneState();

    if (!rawZones || typeof rawZones !== "object") {
      return next;
    }

    for (let i = 1; i <= 40; i++) {
      next[i] = !!(rawZones[i] || rawZones[String(i)]);
    }

    return next;
  }

  function getSelectedZoneIdsFromMap(zones) {
    const ids = [];
    for (let i = 1; i <= 40; i++) {
      if (zones?.[i] || zones?.[String(i)]) {
        ids.push(i);
      }
    }
    return ids;
  }

  function buildLastStatePayload(overrides = {}) {
    const nextOrientation = overrides.orientation ?? effectiveOrientation;
    const nextZones = overrides.zones ?? zoneState;
    const nextPaths = overrides.paths ?? paths;
    const nextSelectedRecipeId =
      overrides.selected_recipe_id ?? selectedRecipeId;

    return {
      orientation: [1, 2, 3, 4].includes(nextOrientation)
        ? nextOrientation
        : null,
      zones: nextZones,
      paths: nextPaths,
      selected_recipe_id: nextSelectedRecipeId,
      saved_at: Date.now(),
    };
  }

  function persistLastState(nextState, options = {}) {
    if (!partId) return;

    if (saveLastStateTimeoutRef.current) {
      clearTimeout(saveLastStateTimeoutRef.current);
      saveLastStateTimeoutRef.current = null;
    }

    fetch(`/api/parts/${partId}/last-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nextState),
      keepalive: !!options.keepalive,
    }).catch(() => {});
  }

  function flushLastState(options = {}) {
    if (!hasLoadedLastStateRef.current) return;
    if (isRestoringLastStateRef.current) return;

    persistLastState(buildLastStatePayload(), options);
  }

  async function handleSaveRecipe() {
    const name = recipeNameInput.trim();
    const description = recipeDescriptionInput.trim();

    if (!name) {
      alert("Recipe name is required");
      return;
    }

    try {
      setSaveRecipeBusy(true);

      const res = await fetch(`/api/recipes/${partId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
          paths,
          zones: zoneState,
        }),
      });

      if (!res.ok) {
        let msg = "Save recipe failed";
        try {
          const err = await res.json();
          msg = err.detail || msg;
        } catch {}
        alert(msg);
        return;
      }

      setSaveRecipeOpen(false);
      setRecipeNameInput("");
      setRecipeDescriptionInput("");
      await refreshRecipes();
    } catch {
      alert("Server error");
    } finally {
      setSaveRecipeBusy(false);
    }
  }

  async function handleLoadRecipe() {
    if (!selectedRecipeId) {
      alert("Select a recipe first");
      return;
    }

    const isDebugMode = debugOrientationOverride !== "live";

    if (!isDebugMode && !opcConnected) {
      alert("OPC is disconnected");
      return;
    }

    const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);
    if (!selectedRecipe) {
      alert("Recipe not found");
      return;
    }

    const selectedRecipeZoneIds = getSelectedZoneIdsFromMap(
      selectedRecipe.zones,
    );
    const invalidRecipeZoneIds = selectedRecipeZoneIds.filter(
      (zoneId) => !validZoneIds.has(zoneId),
    );

    if (invalidRecipeZoneIds.length > 0) {
      alert(
        `Recipe cannot be loaded because these saved zones are not available for the current table orientation: ${invalidRecipeZoneIds.join(", ")}`,
      );
      return;
    }

    try {
      setLoadRecipeBusy(true);

      let recipeData;

      if (isDebugMode) {
        recipeData = selectedRecipe;
      } else {
        const res = await fetch(`/api/recipes/${partId}/load`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipe_id: selectedRecipeId,
          }),
        });

        if (!res.ok) {
          let msg = "Load recipe failed";
          try {
            const err = await res.json();
            msg = err.detail || msg;
          } catch {}
          alert(msg);
          return;
        }

        recipeData = await res.json();
      }

      const nextPaths = normalizeRecipePaths(recipeData?.paths);
      const nextZones = normalizeRecipeZones(recipeData?.zones);

      setPaths(nextPaths);
      setZoneState(nextZones);
      persistLastState(
        buildLastStatePayload({
          paths: nextPaths,
          zones: nextZones,
          selected_recipe_id: selectedRecipeId,
          orientation: effectiveOrientation,
        }),
      );
    } catch {
      alert("Server error");
    } finally {
      setLoadRecipeBusy(false);
    }
  }


  const totalZoneCount = useMemo(() => {
    if (!part || !Array.isArray(part.sections)) return 0;

    return part.sections.reduce((count, section) => {
      return count + (Array.isArray(section.zones) ? section.zones.length : 0);
    }, 0);
  }, [part]);

  const needsZoneSetup = useMemo(() => {
    if (!part) return false;
    if (part.configured === false) return true;
    if (!Array.isArray(part.sections) || part.sections.length === 0)
      return true;
    if (totalZoneCount === 0) return true;
    return false;
  }, [part, totalZoneCount]);

  const firstEditableSection = useMemo(() => {
    if (!part || !Array.isArray(part.sections) || part.sections.length === 0) {
      return 1;
    }

    const sorted = [...part.sections]
      .map((section) => section.index)
      .filter((index) => typeof index === "number")
      .sort((a, b) => a - b);

    return sorted[0] || 1;
  }, [part]);

  const validZoneIds = useMemo(() => {
    if (!part || !Array.isArray(part.sections)) return new Set();
    if (![1, 2, 3, 4].includes(effectiveOrientation)) return new Set();

    const ids = new Set();

    for (const section of part.sections) {
      for (const zone of section.zones || []) {
        if (
          typeof zone.zone_id === "number" &&
          zone.orientation === effectiveOrientation
        ) {
          ids.add(zone.zone_id);
        }
      }
    }

    return ids;
  }, [part, effectiveOrientation]);

  useEffect(() => {
    setZoneState((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const key of Object.keys(next)) {
        const zoneId = Number(key);
        if (next[key] && !validZoneIds.has(zoneId)) {
          next[key] = false;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [validZoneIds]);

  function isZoneAvailable(zone) {
    if (![1, 2, 3, 4].includes(effectiveOrientation)) return false;
    return zone.orientation === effectiveOrientation;
  }

  async function toggleZone(id) {
    if (!validZoneIds.has(id)) return;

    const previousState = zoneState;
    const nextState = {
      ...zoneState,
      [id]: !zoneState[id],
    };

    setZoneState(nextState);
    persistLastState(
      buildLastStatePayload({
        zones: nextState,
        paths,
        selected_recipe_id: selectedRecipeId,
      }),
    );
    await pushZoneState(nextState, () => setZoneState(previousState));
  }

  async function clearAll() {
    const previousState = zoneState;
    const nextState = createEmptyZoneState();

    setZoneState(nextState);
    persistLastState(
      buildLastStatePayload({
        zones: nextState,
        paths,
        selected_recipe_id: null,
      }),
    );
    await pushZoneState(nextState, () => setZoneState(previousState));
  }

  async function selectAllAvailable() {
    const previousState = zoneState;
    const nextState = { ...zoneState };

    for (const zoneId of validZoneIds) {
      nextState[zoneId] = true;
    }

    setZoneState(nextState);
    persistLastState(
      buildLastStatePayload({
        zones: nextState,
        paths,
        selected_recipe_id: selectedRecipeId,
      }),
    );
    await pushZoneState(nextState, () => setZoneState(previousState));
  }

  async function pushZoneState(nextZoneState, onErrorRestore = null) {
    if (!opcConnected) {
      alert("OPC is disconnected");
      if (onErrorRestore) {
        onErrorRestore();
      }
      return;
    }

    try {
      setAutoApplyBusy(true);

      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part_id: partId,
          zones: nextZoneState,
        }),
      });

      if (!res.ok) {
        let msg = "Auto-apply failed";
        try {
          const err = await res.json();
          msg = err.detail || msg;
        } catch {}
        alert(msg);
        if (onErrorRestore) {
          onErrorRestore();
        }
      }
    } catch {
      alert("Server error");
      if (onErrorRestore) {
        onErrorRestore();
      }
    } finally {
      setAutoApplyBusy(false);
    }
  }

  if (!part) {
    return <div style={{ padding: 16 }}>Loading...</div>;
  }

  if (needsZoneSetup) {
    return (
      <div
        style={{
          padding: "6px 14px 12px",
          fontFamily: "Arial, sans-serif",
          color: "#1f2937",
          width: "100%",
          boxSizing: "border-box",
          height: `calc(100vh - ${HEADER_HEIGHT}px)`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ marginBottom: 4, flex: "0 0 auto" }}>
          <Link
            to="/"
            style={backLinkStyle}
            onClick={() => flushLastState({ keepalive: true })}
          >
            ← <span style={{ verticalAlign: "middle" }}>Back to Parts</span>
          </Link>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: 18,
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.06)",
              padding: "28px 24px",
              textAlign: "center",
            }}
          >
            <h1
              style={{
                margin: "0 0 10px",
                fontSize: 32,
                fontWeight: 800,
                color: "#111827",
                lineHeight: 1.1,
              }}
            >
              {part.display_name}
            </h1>

            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1f2937",
                marginBottom: 10,
              }}
            >
              Zones are not configured for this part
            </div>

            <div
              style={{
                fontSize: 14,
                color: "#6b7280",
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              This part cannot be opened until at least one section has valid
              zone data.
            </div>

            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 13,
                color: "#475569",
                lineHeight: 1.5,
                marginBottom: 20,
                textAlign: "left",
              }}
            >
              {part.missing_zones_sections?.length > 0 ? (
                <>
                  Missing zone files for sections:{" "}
                  {part.missing_zones_sections.join(", ")}
                </>
              ) : (
                <>Zone files exist, but no zones have been created yet.</>
              )}
            </div>

            <button
              onClick={() => {
                window.location.href = `/admin/editor/${part.part_id}/${firstEditableSection}?return=part`;
              }}
              style={{
                padding: "12px 18px",
                border: "1px solid #2563eb",
                borderRadius: 12,
                background: "#2563eb",
                color: "#ffffff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                minWidth: 190,
              }}
            >
              Open Zone Editor
            </button>
          </div>
        </div>
      </div>
    );
  }

  const orientationText =
    debugOrientationOverride !== "live"
      ? ORIENTATION_LABELS[effectiveOrientation] || "Unknown"
      : tableOrientationDegrees != null
        ? `${tableOrientationDegrees}°`
        : ORIENTATION_LABELS[tableOrientation] || "Unknown";

  const selectedCount = Object.values(zoneState).filter(Boolean).length;

  return (
    <div
      style={{
        padding: "6px 14px 12px",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
        width: "100%",
        boxSizing: "border-box",
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ marginBottom: 4, flex: "0 0 auto" }}>
        <Link
          to="/"
          style={backLinkStyle}
          onClick={() => flushLastState({ keepalive: true })}
        >
          ← <span style={{ verticalAlign: "middle" }}>Back to Parts</span>
        </Link>
      </div>

      <div style={{ marginBottom: 8, flex: "0 0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>{part.display_name}</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow
            ? "1fr"
            : "max-content minmax(0, 1fr) 300px",
          gap: 10,
          alignItems: "stretch",
          width: "100%",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 10,
            alignContent: "start",
            alignItems: "start",
            overflow: "auto",
            minHeight: 0,
            maxHeight: "100%",
            width: "fit-content",
            minWidth: 0,
            paddingRight: 2,
          }}
        >
          {/* FORCE */}
          <Card title="Live Force Reading">
            <div style={{ fontSize: 28, fontWeight: 700 }}>
              {forceReading !== null ? forceReading.toFixed(2) : "No Reading"}
            </div>
          </Card>

          {/* RECIPE SETUP */}
          <Card title="Recipe Setup">
            {paths.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px 58px 88px 58px",
                  columnGap: 6,
                  rowGap: 3,
                  alignItems: "end",
                  marginBottom: i === paths.length - 1 ? 0 : 8,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    alignSelf: "center",
                  }}
                >
                  {i + 1}.
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontWeight: 600,
                  }}
                >
                  Passes
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontWeight: 600,
                  }}
                >
                  {i < 3 ? "Grit" : "Material"}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontWeight: 600,
                  }}
                >
                  Force
                </span>

                <div />

                <input
                  type="number"
                  min="0"
                  value={p.passes}
                  onChange={(e) =>
                    updatePath(i, "passes", Number(e.target.value))
                  }
                  style={{
                    width: 58,
                    padding: "7px 8px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />

                {i < 3 ? (
                  <select
                    value={p.grit}
                    onChange={(e) =>
                      updatePath(i, "grit", Number(e.target.value))
                    }
                    style={{
                      width: 88,
                      padding: "7px 8px",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      background: "#fff",
                      boxSizing: "border-box",
                    }}
                  >
                    {[80, 120, 180].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div
                    style={{
                      width: 88,
                      padding: "7px 8px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#f9fafb",
                      color: "#374151",
                      fontWeight: 600,
                      boxSizing: "border-box",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Scotch
                  </div>
                )}

                <input
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  value={p.force ?? 10}
                  onChange={(e) =>
                    updatePath(i, "force", Number(e.target.value))
                  }
                  style={{
                    width: 58,
                    padding: "7px 8px",
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
          </Card>

          {/* RECIPES */}
          <Card title="Recipes">
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {recipesLoading && (
                <div
                  style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}
                >
                  Loading recipes...
                </div>
              )}

              {!recipesLoading && recipes.length === 0 && (
                <div
                  style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}
                >
                  No recipes saved
                </div>
              )}

              {recipes.map((r) => (
                <div
                  key={r.id}
                  onClick={() =>
                    setSelectedRecipeId((prev) => (prev === r.id ? null : r.id))
                  }
                  style={{
                    padding: 8,
                    border:
                      selectedRecipeId === r.id
                        ? "2px solid #2563eb"
                        : "1px solid #ddd",
                    borderRadius: 8,
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {r.description}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                onClick={handleLoadRecipe}
                disabled={
                  !selectedRecipeId ||
                  loadRecipeBusy ||
                  (!opcConnected && debugOrientationOverride === "live")
                }
                style={{
                  ...buttonStyle(
                    !selectedRecipeId ||
                      loadRecipeBusy ||
                      (!opcConnected && debugOrientationOverride === "live"),
                  ),
                  textAlign: "center",
                  flex: 1,
                  padding: "8px 12px",
                }}
              >
                {loadRecipeBusy ? "Loading..." : "Load"}
              </button>
              <button
                onClick={() => {
                  setRecipeNameInput("");
                  setRecipeDescriptionInput("");
                  setSaveRecipeOpen(true);
                }}
                style={{
                  ...buttonStyle(),
                  textAlign: "center",
                  flex: 1,
                  padding: "8px 12px",
                }}
              >
                Save
              </button>
            </div>
          </Card>
        </div>

        {/* CANVAS COLUMN */}
        <div
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 14,
            background: "#fff",
            padding: 8,
            minWidth: 0,
            width: "100%",
            boxSizing: "border-box",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              width: "100%",
              height: "100%",
              minHeight: 0,
            }}
          >
            {part.sections.map((section) => (
              <div
                key={section.index}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#f8fafc",
                  width: "100%",
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {part.sections.length > 1 && (
                  <div
                    style={{
                      padding: "8px 12px",
                      borderBottom: "1px solid #e5e7eb",
                      fontWeight: 700,
                      background: "#f9fafb",
                      flex: "0 0 auto",
                    }}
                  >
                    Section {section.index}
                  </div>
                )}

                <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
                  <SectionViewer
                    section={section}
                    zoneState={zoneState}
                    toggleZone={toggleZone}
                    hoveredZone={hoveredZone}
                    setHoveredZone={setHoveredZone}
                    isZoneAvailable={isZoneAvailable}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            width: "100%",
            alignContent: "start",
            overflow: "auto",
            minHeight: 0,
            paddingRight: 2,
          }}
        >
          <Card title="Status">
            <StatusRow
              label="OPC"
              value={opcConnected ? "Connected" : "Disconnected"}
              valueColor={opcConnected ? "#166534" : "#991b1b"}
              valueBg={opcConnected ? "#dcfce7" : "#fee2e2"}
            />
            <StatusRow
              label="Orientation"
              value={
                [1, 2, 3, 4].includes(effectiveOrientation)
                  ? orientationText
                  : "Unavailable"
              }
              valueColor="#1f2937"
              valueBg="#f3f4f6"
            />
            <StatusRow
              label="Selected zones"
              value={String(selectedCount)}
              valueColor="#1f2937"
              valueBg="#f3f4f6"
            />
          </Card>

          <Card title="Zone Actions">
            <div style={{ display: "grid", gap: 10 }}>
              <button
                onClick={clearAll}
                disabled={!opcConnected || autoApplyBusy}
                title={!opcConnected ? "OPC disconnected" : ""}
                style={buttonStyle(!opcConnected || autoApplyBusy)}
              >
                Clear All
              </button>

              <button
                onClick={selectAllAvailable}
                disabled={
                  validZoneIds.size === 0 || !opcConnected || autoApplyBusy
                }
                title={
                  !opcConnected
                    ? "OPC disconnected"
                    : validZoneIds.size === 0
                      ? "No zones available for current orientation"
                      : ""
                }
                style={buttonStyle(
                  validZoneIds.size === 0 || !opcConnected || autoApplyBusy,
                )}
              >
                Select All Available
              </button>
            </div>
          </Card>

          <Card title="Debug">
            <div style={{ display: "grid", gap: 8 }}>
              <label
                style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}
              >
                Orientation override
              </label>
              <select
                value={debugOrientationOverride}
                onChange={(e) => setDebugOrientationOverride(e.target.value)}
                style={{
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 10,
                  background: "#fff",
                  fontSize: 14,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <option value="live">Live OPC</option>
                <option value="1">0°</option>
                <option value="2">90°</option>
                <option value="3">180°</option>
                <option value="4">270°</option>
              </select>

              {debugOrientationOverride !== "live" && (
                <div
                  style={{
                    fontSize: 13,
                    color: "#92400e",
                    background: "#fef3c7",
                    border: "1px solid #fcd34d",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontWeight: 600,
                  }}
                >
                  Debug override active
                </div>
              )}
            </div>
          </Card>

          <Card title="Admin">
            <div style={{ display: "grid", gap: 8 }}>
              <button
                onClick={() => {
                  window.location.href = `/admin/editor/${part.part_id}/1?return=part`;
                }}
                style={buttonStyle()}
              >
                Edit Zones
              </button>

              <button
                onClick={() => {
                  window.location.href = `/admin/recipes/${part.part_id}?return=part`;
                }}
                style={buttonStyle()}
              >
                Edit Recipes
              </button>
            </div>
          </Card>
        </div>
      </div>

      {saveRecipeOpen && (
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
            if (saveRecipeBusy) return;
            setSaveRecipeOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#ffffff",
              border: "1px solid #d1d5db",
              borderRadius: 18,
              boxShadow: "0 20px 50px rgba(15, 23, 42, 0.18)",
              padding: "22px 20px",
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#111827",
                marginBottom: 8,
              }}
            >
              Save Recipe
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#6b7280",
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              Save the current path setup and selected zones for this part.
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
                  Recipe Name
                </label>
                <input
                  type="text"
                  value={recipeNameInput}
                  onChange={(e) => setRecipeNameInput(e.target.value)}
                  placeholder="Enter recipe name"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 10,
                    boxSizing: "border-box",
                    fontSize: 14,
                  }}
                  disabled={saveRecipeBusy}
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
                  Description
                </label>
                <textarea
                  value={recipeDescriptionInput}
                  onChange={(e) => setRecipeDescriptionInput(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid #d1d5db",
                    borderRadius: 10,
                    boxSizing: "border-box",
                    fontSize: 14,
                    resize: "vertical",
                    fontFamily: "Arial, sans-serif",
                  }}
                  disabled={saveRecipeBusy}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 18,
              }}
            >
              <button
                onClick={() => setSaveRecipeOpen(false)}
                disabled={saveRecipeBusy}
                style={{
                  ...buttonStyle(saveRecipeBusy),
                  width: "auto",
                  textAlign: "center",
                  padding: "9px 14px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRecipe}
                disabled={saveRecipeBusy}
                style={{
                  ...primaryButtonStyle(saveRecipeBusy),
                  width: "auto",
                  textAlign: "center",
                  padding: "9px 14px",
                }}
              >
                {saveRecipeBusy ? "Saving..." : "Save Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionViewer({
  section,
  zoneState,
  toggleZone,
  hoveredZone,
  setHoveredZone,
  isZoneAvailable,
}) {
  const containerRef = useRef(null);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });

  const sourceWidth = section.image_size?.width || 1920;
  const sourceHeight = section.image_size?.height || 1080;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function updateFit() {
      const bounds = el.getBoundingClientRect();
      const containerWidth = bounds.width;
      const containerHeight = bounds.height;

      if (!containerWidth || !containerHeight) return;

      const scale = Math.min(
        containerWidth / sourceWidth,
        containerHeight / sourceHeight,
      );

      setFitSize({
        width: Math.floor(sourceWidth * scale),
        height: Math.floor(sourceHeight * scale),
      });
    }

    updateFit();

    const observer = new ResizeObserver(updateFit);
    observer.observe(el);

    return () => observer.disconnect();
  }, [sourceWidth, sourceHeight]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: fitSize.width,
          height: fitSize.height,
          flex: "0 0 auto",
        }}
      >
        <img
          src={section.image_url}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: fitSize.width,
            height: fitSize.height,
            display: "block",
            objectFit: "fill",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />

        <svg
          viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
          style={{
            position: "absolute",
            inset: 0,
            width: fitSize.width,
            height: fitSize.height,
          }}
        >
          {section.zones.map((z) => {
            const active = !!zoneState[z.zone_id];
            const hovered = hoveredZone === z.zone_id;
            const available = isZoneAvailable(z);

            const fill = active
              ? "rgba(22,163,74,0.42)"
              : !available
                ? "rgba(107,114,128,0.14)"
                : hovered
                  ? "rgba(59,130,246,0.32)"
                  : "rgba(59,130,246,0.20)";

            const stroke = active
              ? "rgba(21,128,61,0.95)"
              : !available
                ? "rgba(107,114,128,0.45)"
                : hovered
                  ? "rgba(59,130,246,0.7)"
                  : "rgba(107,114,128,0.25)";

            return (
              <polygon
                key={z.zone_id}
                points={z.points.map((p) => p.join(",")).join(" ")}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                onClick={() => {
                  if (!available) return;
                  toggleZone(z.zone_id);
                }}
                onMouseEnter={() => setHoveredZone(z.zone_id)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{
                  cursor: available ? "pointer" : "not-allowed",
                  transition: "fill 0.12s ease, stroke 0.12s ease",
                }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 14,
        background: "#fff",
        padding: 10,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 15,
          marginBottom: 10,
          color: "#111827",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusRow({ label, value, valueColor, valueBg }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: 14, color: "#4b5563", fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: valueColor,
          background: valueBg,
          borderRadius: 999,
          padding: "6px 10px",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function buttonStyle(disabled = false) {
  return {
    padding: "10px 14px",
    border: "1px solid #d1d5db",
    borderRadius: 10,
    background: disabled ? "#f3f4f6" : "#fff",
    color: disabled ? "#9ca3af" : "#111827",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
    fontWeight: 600,
    textAlign: "left",
    width: "100%",
    boxSizing: "border-box",
  };
}

function primaryButtonStyle(disabled = false) {
  return {
    padding: "10px 14px",
    border: "1px solid #2563eb",
    borderRadius: 10,
    background: disabled ? "#dbeafe" : "#2563eb",
    color: disabled ? "#6b7280" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
    fontWeight: 700,
    textAlign: "left",
    opacity: disabled ? 0.6 : 1,
    width: "100%",
    boxSizing: "border-box",
  };
}

const backLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: 18,
  fontWeight: 700,
};
