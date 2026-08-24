import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useSession } from "../SessionContext.jsx";
import { useProgramProgress } from "../hooks/useProgramProgress.js";
import {
  getDefaultPaths,
  normalizePaths,
  createEmptyZoneState,
  normalizeZoneMap,
  getActivePathIndex,
} from "../lib/recipes.js";
import { SLOT_COLORS } from "../lib/sections.js";
import { unionOfZones } from "../lib/sectionShapes.js";

const ORIENTATION_LABELS = {
  1: "0°",
  2: "90°",
  3: "180°",
  4: "270°",
};

const HEADER_HEIGHT = 96;

export default function PartPage() {
  const { partId } = useParams();
  const navigate = useNavigate();

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
  const sessionData = useSession();
  const sessionUser = sessionData?.authenticated ? sessionData.user : null;


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
  const zoneStateRef = useRef({});

  const [sectionState, setSectionState] = useState({ 1: false, 2: false, 3: false, 4: false, 5: false });
  const sectionSourceRef = useRef({});

  const pathsRef = useRef(getDefaultPaths());

  // Keep pathsRef in sync so useProgramProgress always reads the latest paths
  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // Keep zoneStateRef in sync for the orientation-clear effect (reads without re-triggering it)
  useEffect(() => {
    zoneStateRef.current = zoneState;
  }, [zoneState]);

  const programProgress = useProgramProgress(opcConnected, pathsRef);

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

      fetch("/api/active-part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: data.part_id, display_name: data.display_name }),
      }).catch(() => {});

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
    let t = null;
    const connectedRef = { current: false };

    async function poll() {
      try {
        const res = await fetch(`/api/opc/status?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await res.json();

        if (!cancelled) {
          const nowConnected = !!data.connected;
          setOpcConnected(nowConnected);
          setOpcStatusLoaded(true);

          if (nowConnected !== connectedRef.current) {
            connectedRef.current = nowConnected;
            clearInterval(t);
            t = setInterval(poll, nowConnected ? 150 : 2000);
          }
        }
      } catch {
        if (!cancelled) {
          setOpcConnected(false);
          setOpcStatusLoaded(true);

          if (connectedRef.current) {
            connectedRef.current = false;
            clearInterval(t);
            t = setInterval(poll, 2000);
          }
        }
      }
    }

    poll();
    t = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!opcConnected) {
      setTableOrientation(null);
      setTableOrientationDegrees(null);
      return;
    }

    let cancelled = false;

    async function pollOrientation() {
      try {
        const res = await fetch(`/api/opc/orientation?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setTableOrientation(
            [1, 2, 3, 4].includes(data.orientation) ? data.orientation : null,
          );
          setTableOrientationDegrees(
            typeof data.degrees === "number" ? data.degrees : null,
          );
        }
      } catch {
        if (!cancelled) {
          setTableOrientation(null);
          setTableOrientationDegrees(null);
        }
      }
    }

    pollOrientation();
    const t = setInterval(pollOrientation, 150);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [opcConnected]);

  useEffect(() => {
    if (!opcConnected) {
      setForceReading(null);
      return;
    }

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
    const t = setInterval(pollForce, 150);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [opcConnected]);


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
    // Wait for orientation poll to return before restoring, otherwise we'd
    // commit hasLoadedLastStateRef=true with effectiveOrientation=null and
    // never correctly restore zones on page load.
    if (opcConnected && effectiveOrientation === null && debugOrientationOverride === "live") return;
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

        // Restore section state
        const savedSections = Array.isArray(data.sections) ? data.sections : [];
        const nextSectionState = { 1: false, 2: false, 3: false, 4: false, 5: false };
        if (orientationMatches) {
          for (const slot of savedSections) {
            if (slot >= 1 && slot <= 5) nextSectionState[slot] = true;
          }
        }
        // Only keep sections whose orientation matches current
        if (orientationMatches && part) {
          const partSections = part.sections || [];
          for (const slot of Object.keys(nextSectionState)) {
            const s = partSections.find((ps) => ps.slot === Number(slot));
            if (nextSectionState[slot] && s && s.orientation !== effectiveOrientation) {
              nextSectionState[slot] = false;
            }
          }
        }

        const activeSlotsToRestore = Object.entries(nextSectionState)
          .filter(([, v]) => v)
          .map(([k]) => Number(k));

        const savedSources = data.section_sources && typeof data.section_sources === "object" ? data.section_sources : {};
        const restoredSources = {};
        for (const slot of activeSlotsToRestore) {
          const src = savedSources[slot] ?? savedSources[String(slot)];
          restoredSources[slot] = src === "auto" ? "auto" : "manual";
        }

        if (!cancelled) {
          setPaths(nextPaths);
          setZoneState(nextZones);
          setSelectedRecipeId(nextSelectedRecipeId);
          setSectionState(nextSectionState);
          sectionSourceRef.current = restoredSources;
        }

        if (debugOrientationOverride === "live" && opcConnected) {
          writePathsToOPC(nextPaths);
          await pushZoneState(nextZones, { sections: activeSlotsToRestore });
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

  const normalizeRecipePaths = normalizePaths;
  const normalizeRecipeZones = normalizeZoneMap;

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
    const nextSectionState = overrides.section_state ?? sectionState;
    const nextSectionSources = overrides.section_sources ?? sectionSourceRef.current;

    const activeSources = {};
    for (const [slot, active] of Object.entries(nextSectionState)) {
      if (active) activeSources[slot] = nextSectionSources[slot] || "manual";
    }

    return {
      orientation: [1, 2, 3, 4].includes(nextOrientation)
        ? nextOrientation
        : null,
      zones: nextZones,
      paths: nextPaths,
      selected_recipe_id: nextSelectedRecipeId,
      sections: Object.entries(nextSectionState)
        .filter(([, v]) => v)
        .map(([k]) => Number(k)),
      section_sources: activeSources,
      saved_at: Date.now(),
    };
  }

  function persistLastState(nextState, options = {}) {
    if (!partId) return;

    if (options.keepalive) {
      if (saveLastStateTimeoutRef.current) {
        clearTimeout(saveLastStateTimeoutRef.current);
        saveLastStateTimeoutRef.current = null;
      }
      fetch(`/api/parts/${partId}/last-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState),
        keepalive: true,
      }).catch(() => {});
      return;
    }

    if (saveLastStateTimeoutRef.current) {
      clearTimeout(saveLastStateTimeoutRef.current);
    }
    saveLastStateTimeoutRef.current = setTimeout(() => {
      saveLastStateTimeoutRef.current = null;
      fetch(`/api/parts/${partId}/last-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextState),
      }).catch(() => {});
    }, 300);
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
          sections: Object.entries(sectionState).filter(([, v]) => v).map(([k]) => Number(k)),
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

      // D9: restore section state from recipe
      const recipeSectionSlots = Array.isArray(recipeData?.sections) ? recipeData.sections : [];
      const nextSectionState = { 1: false, 2: false, 3: false, 4: false, 5: false };
      for (const slot of recipeSectionSlots) {
        if (slot >= 1 && slot <= 5) nextSectionState[slot] = true;
      }

      setPaths(nextPaths);
      setZoneState(nextZones);
      setSectionState(nextSectionState);
      persistLastState(
        buildLastStatePayload({
          paths: nextPaths,
          zones: nextZones,
          selected_recipe_id: selectedRecipeId,
          orientation: effectiveOrientation,
          section_state: nextSectionState,
        }),
      );
    } catch {
      alert("Server error");
    } finally {
      setLoadRecipeBusy(false);
    }
  }


  const needsZoneSetup = useMemo(() => {
    if (!part) return false;
    if (part.configured === false) return true;
    if (!Array.isArray(part.zones) || part.zones.length === 0) return true;
    return false;
  }, [part]);

  const validZoneIds = useMemo(() => {
    if (!part || !Array.isArray(part.zones)) return new Set();
    if (![1, 2, 3, 4].includes(effectiveOrientation)) return new Set();

    const ids = new Set();
    for (const zone of part.zones) {
      if (
        typeof zone.zone_id === "number" &&
        zone.orientation === effectiveOrientation
      ) {
        ids.add(zone.zone_id);
      }
    }
    return ids;
  }, [part, effectiveOrientation]);

  useEffect(() => {
    const prev = zoneStateRef.current;
    const next = { ...prev };
    let changed = false;

    for (const key of Object.keys(next)) {
      const zoneId = Number(key);
      if (next[key] && !validZoneIds.has(zoneId)) {
        next[key] = false;
        changed = true;
      }
    }

    if (!changed) return;

    setZoneState(next);

    if (
      hasLoadedLastStateRef.current &&
      !isRestoringLastStateRef.current &&
      opcConnected
    ) {
      fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: partId, zones: next }),
      }).catch(() => {});
    }
  }, [validZoneIds]);

  // Clear section slots whose orientation no longer matches
  useEffect(() => {
    if (!part) return;
    const partSections = part.sections || [];
    const next = { ...sectionState };
    let changed = false;
    const clearedSlots = [];

    for (const [slotStr, active] of Object.entries(next)) {
      if (!active) continue;
      const slot = Number(slotStr);
      const s = partSections.find((ps) => ps.slot === slot);
      if (!s || s.orientation !== effectiveOrientation) {
        next[slot] = false;
        changed = true;
        clearedSlots.push(slot);
      }
    }

    if (!changed) return;

    if (clearedSlots.length > 0) {
      const nextSources = { ...sectionSourceRef.current };
      for (const slot of clearedSlots) delete nextSources[slot];
      sectionSourceRef.current = nextSources;
    }

    setSectionState(next);

    if (hasLoadedLastStateRef.current && !isRestoringLastStateRef.current && opcConnected) {
      const activeSectionSlots = Object.entries(next)
        .filter(([, v]) => v)
        .map(([k]) => Number(k));
      fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_id: partId, zones: zoneStateRef.current, sections: activeSectionSlots }),
      }).catch(() => {});
    }
  }, [effectiveOrientation, part]);

  function isZoneAvailable(zone) {
    if (![1, 2, 3, 4].includes(effectiveOrientation)) return false;
    return zone.orientation === effectiveOrientation;
  }

  function promoteSections(zoneMap, currentSectionState, partSections, orientation) {
    const sections = { ...currentSectionState };
    const zones = { ...zoneMap };
    const promoted = [];
    let changed;
    do {
      changed = false;
      for (const s of partSections) {
        if (s.orientation !== orientation) continue;
        if (sections[s.slot]) continue;
        if (s.zone_ids.length < 2) continue;
        const isCovered = (zid) =>
          zones[zid] || partSections.some((o) => sections[o.slot] && o.zone_ids.includes(zid));
        if (s.zone_ids.every(isCovered)) {
          sections[s.slot] = true;
          promoted.push(s.slot);
          for (const zid of s.zone_ids) {
            if (zones[zid]) zones[zid] = false;
          }
          changed = true;
        }
      }
    } while (changed);
    return { zones, sections, promoted };
  }

  async function toggleZone(id) {
    if (!validZoneIds.has(id)) return;

    const partSections = part?.sections || [];

    // First: if zone belongs to any active non-auto section it is locked
    const isLockedByManual = partSections.some(
      (s) => sectionState[s.slot] && s.zone_ids.includes(id) && sectionSourceRef.current[s.slot] !== "auto",
    );
    if (isLockedByManual) return;

    // Then: if zone belongs to an active auto section → demote + re-promote
    const autoSection = partSections.find(
      (s) => sectionState[s.slot] && s.zone_ids.includes(id) && sectionSourceRef.current[s.slot] === "auto",
    );
    if (autoSection) {
      const slot = autoSection.slot;
      const previousZoneState = zoneState;
      const previousSectionState = sectionState;
      const demotedSections = { ...sectionState, [slot]: false };
      const demotedZones = { ...zoneState };
      for (const zid of autoSection.zone_ids) demotedZones[zid] = zid !== id;
      const sourcesAfterDemote = { ...sectionSourceRef.current };
      delete sourcesAfterDemote[slot];

      // Re-run promotion — another section may now be complete
      const { zones: promotedZones, sections: promotedSections, promoted } = promoteSections(demotedZones, demotedSections, partSections, effectiveOrientation);
      const nextSources = { ...sourcesAfterDemote };
      for (const s of promoted) nextSources[s] = "auto";
      sectionSourceRef.current = nextSources;

      const activeSectionSlots = Object.entries(promotedSections).filter(([, v]) => v).map(([k]) => Number(k));
      setSectionState(promotedSections);
      setZoneState(promotedZones);
      setSelectedRecipeId(null);
      persistLastState(buildLastStatePayload({ zones: promotedZones, section_state: promotedSections, selected_recipe_id: null, section_sources: nextSources }));
      await pushZoneState(promotedZones, {
        sections: activeSectionSlots,
        onErrorRestore: () => {
          setZoneState(previousZoneState);
          setSectionState(previousSectionState);
          sectionSourceRef.current = { ...sectionSourceRef.current, [slot]: "auto" };
        },
      });
      return;
    }

    const previousState = zoneState;
    const rawNext = { ...zoneState, [id]: !zoneState[id] };

    // Auto-promote: if all member zones of a section are now on, activate it
    const { zones: nextZones, sections: nextSections, promoted } = promoteSections(rawNext, sectionState, partSections, effectiveOrientation);

    const nextSources = { ...sectionSourceRef.current };
    for (const slot of promoted) nextSources[slot] = "auto";
    sectionSourceRef.current = nextSources;

    const activeSectionSlots = Object.entries(nextSections).filter(([, v]) => v).map(([k]) => Number(k));
    setSectionState(nextSections);
    setZoneState(nextZones);
    setSelectedRecipeId(null);
    persistLastState(buildLastStatePayload({ zones: nextZones, section_state: nextSections, selected_recipe_id: null, section_sources: nextSources }));
    await pushZoneState(nextZones, { sections: activeSectionSlots, onErrorRestore: () => { setZoneState(previousState); setSectionState(sectionState); } });
  }

  async function clearAll() {
    const previousZoneState = zoneState;
    const previousSectionState = sectionState;
    const clearedSectionState = { 1: false, 2: false, 3: false, 4: false, 5: false };
    const nextState = createEmptyZoneState();

    sectionSourceRef.current = {};
    setZoneState(nextState);
    setSectionState(clearedSectionState);
    setSelectedRecipeId(null);
    persistLastState(
      buildLastStatePayload({
        zones: nextState,
        paths,
        selected_recipe_id: null,
        section_state: clearedSectionState,
        section_sources: {},
      }),
    );
    await pushZoneState(nextState, {
      sections: [],
      onErrorRestore: () => {
        setZoneState(previousZoneState);
        setSectionState(previousSectionState);
      },
    });
  }

  async function selectAllAvailable() {
    const previousZoneState = zoneState;
    const previousSectionState = sectionState;
    const partSections = part?.sections || [];
    const rawNext = { ...zoneState };

    const lockedZoneIds = new Set();
    for (const s of partSections) {
      if (sectionState[s.slot]) {
        for (const zid of s.zone_ids) lockedZoneIds.add(zid);
      }
    }

    for (const zoneId of validZoneIds) {
      if (!lockedZoneIds.has(zoneId)) rawNext[zoneId] = true;
    }

    const { zones: nextZones, sections: nextSections, promoted } = promoteSections(rawNext, sectionState, partSections, effectiveOrientation);

    const nextSources = { ...sectionSourceRef.current };
    for (const slot of promoted) nextSources[slot] = "auto";
    sectionSourceRef.current = nextSources;

    const activeSectionSlots = Object.entries(nextSections).filter(([, v]) => v).map(([k]) => Number(k));
    setSectionState(nextSections);
    setZoneState(nextZones);
    setSelectedRecipeId(null);
    persistLastState(buildLastStatePayload({ zones: nextZones, section_state: nextSections, selected_recipe_id: null, section_sources: nextSources }));
    await pushZoneState(nextZones, {
      sections: activeSectionSlots,
      onErrorRestore: () => { setZoneState(previousZoneState); setSectionState(previousSectionState); },
    });
  }

  async function toggleSection(slot) {
    if (!part) return;
    const section = (part.sections || []).find((s) => s.slot === slot);
    if (!section) return;
    if (section.orientation !== effectiveOrientation) return;
    if (!opcConnected) {
      alert("OPC is disconnected");
      return;
    }

    const previousSectionState = sectionState;
    const previousZoneState = zoneState;
    const isActivating = !sectionState[slot];
    const nextSectionState = { ...sectionState, [slot]: isActivating };
    const activeSectionSlots = Object.entries(nextSectionState)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    // Track source: manual when activating, clear when deactivating
    const nextSources = { ...sectionSourceRef.current };
    if (isActivating) {
      nextSources[slot] = "manual";
    } else {
      delete nextSources[slot];
    }
    sectionSourceRef.current = nextSources;

    setSectionState(nextSectionState);

    // Auto-deselect member zones of all active sections
    const nextZones = { ...zoneState };
    for (const [slotStr, active] of Object.entries(nextSectionState)) {
      if (!active) continue;
      const activeSec = (part.sections || []).find((ps) => ps.slot === Number(slotStr));
      if (activeSec) {
        for (const zid of activeSec.zone_ids) {
          nextZones[zid] = false;
        }
      }
    }
    setZoneState(nextZones);

    setSelectedRecipeId(null);
    persistLastState(buildLastStatePayload({ section_state: nextSectionState, zones: nextZones, selected_recipe_id: null, section_sources: nextSources }));
    await pushZoneState(nextZones, {
      sections: activeSectionSlots,
      onErrorRestore: () => {
        setSectionState(previousSectionState);
        setZoneState(previousZoneState);
        sectionSourceRef.current = previousSectionState[slot] ? { ...sectionSourceRef.current, [slot]: nextSources[slot] } : sectionSourceRef.current;
      },
    });
  }

  async function pushZoneState(nextZoneState, { sections: activeSectionSlots = null, onErrorRestore = null } = {}) {
    if (!opcConnected) {
      alert("OPC is disconnected");
      if (onErrorRestore) {
        onErrorRestore();
      }
      return;
    }

    const slotsToSend = activeSectionSlots ?? Object.entries(sectionState)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    try {
      setAutoApplyBusy(true);

      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part_id: partId,
          zones: nextZoneState,
          sections: slotsToSend,
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

  const currentRole = sessionUser?.role || null;
  const canSeeDebug = currentRole === "admin";
  const canSeeAdmin = currentRole === "admin" || currentRole === "supervisor";
  const canSaveRecipe = currentRole === "admin" || currentRole === "supervisor";

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
              This part cannot be opened until zones have been configured.
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
              No zones exist yet for this part.
            </div>

            {canSeeAdmin ? (
              <button
                onClick={() => {
                  navigate(`/admin/editor/${part.part_id}?return=part`);
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
            ) : (
              <div
                style={{
                  fontSize: 13,
                  color: "#6b7280",
                  fontWeight: 600,
                }}
              >
                Contact a supervisor or admin to configure zones for this part.
              </div>
            )}
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
              <div key={i}>
              <div
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
                  if (!canSaveRecipe) return;
                  setRecipeNameInput("");
                  setRecipeDescriptionInput("");
                  setSaveRecipeOpen(true);
                }}
                disabled={!canSaveRecipe}
                title={!canSaveRecipe ? "Supervisor or admin required to save recipes" : undefined}
                style={{
                  ...buttonStyle(!canSaveRecipe),
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
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {/* Section buttons row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, flex: "0 0 auto" }}>
            {[1, 2, 3, 4, 5].map((slot) => {
              const section = (part.sections || []).find((s) => s.slot === slot);
              if (!section) {
                return (
                  <button
                    key={slot}
                    disabled
                    style={{
                      padding: "6px 4px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      background: "#f9fafb",
                      color: "#d1d5db",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "not-allowed",
                      textAlign: "center",
                    }}
                  >
                    —
                  </button>
                );
              }
              const isActive = !!sectionState[slot];
              const isAvailable = section.orientation === effectiveOrientation;
              const color = SLOT_COLORS[slot];
              return (
                <button
                  key={slot}
                  onClick={() => toggleSection(slot)}
                  disabled={!isAvailable || !opcConnected || autoApplyBusy}
                  title={
                    !opcConnected
                      ? "OPC disconnected"
                      : !isAvailable
                        ? `Needs orientation ${section.orientation === 1 ? "0°" : section.orientation === 2 ? "90°" : section.orientation === 3 ? "180°" : "270°"}`
                        : section.name
                  }
                  style={{
                    padding: "6px 4px",
                    border: `2px solid ${isActive ? color.stroke : "#d1d5db"}`,
                    borderRadius: 8,
                    background: isActive ? color.active : "#fff",
                    color: isActive ? color.text : "#374151",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: isAvailable && opcConnected && !autoApplyBusy ? "pointer" : "not-allowed",
                    opacity: isAvailable ? 1 : 0.45,
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {section.name || `S${slot}`}
                </button>
              );
            })}
          </div>

          {/* Canvas fills remaining space */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <ZoneCanvas
              imageUrl={part.image_url}
              imageSize={part.image_size}
              zones={part.zones}
              zoneState={zoneState}
              toggleZone={toggleZone}
              hoveredZone={hoveredZone}
              setHoveredZone={setHoveredZone}
              isZoneAvailable={isZoneAvailable}
              sections={part.sections || []}
              sectionState={sectionState}
              sectionSources={sectionSourceRef.current}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: "100%",
            height: "100%",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          <Card title="Status" style={{ flex: "0 0 auto" }}>
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
            <StatusRow
              label="Active sections"
              value={
                Object.entries(sectionState)
                  .filter(([, v]) => v)
                  .map(([k]) => {
                    const s = (part?.sections || []).find((ps) => ps.slot === Number(k));
                    return s?.name || `S${k}`;
                  })
                  .join(", ") || "—"
              }
              valueColor="#1f2937"
              valueBg="#f3f4f6"
            />
          </Card>

          <Card title="Zone Actions" style={{ flex: "0 0 auto" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <button
                onClick={selectAllAvailable}
                disabled={validZoneIds.size === 0 || !opcConnected || autoApplyBusy}
                title={
                  !opcConnected
                    ? "OPC disconnected"
                    : validZoneIds.size === 0
                      ? "No zones available for current orientation"
                      : ""
                }
                style={buttonStyle(validZoneIds.size === 0 || !opcConnected || autoApplyBusy)}
              >
                Select All Available
              </button>

              <button
                onClick={clearAll}
                disabled={!opcConnected || autoApplyBusy}
                title={!opcConnected ? "OPC disconnected" : ""}
                style={buttonStyle(!opcConnected || autoApplyBusy)}
              >
                Clear All
              </button>
            </div>
          </Card>

          {canSeeDebug && (
            <Card title="Debug" style={{ flex: "0 0 auto" }}>
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
          )}

          {canSeeAdmin && (
            <Card title="Admin" style={{ flex: "0 0 auto" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  onClick={() => {
                    navigate(`/admin/editor/${part.part_id}?return=part`);
                  }}
                  style={buttonStyle()}
                >
                  Edit Zones
                </button>

                <button
                  onClick={() => {
                    navigate(`/admin/recipes/${part.part_id}?return=part`);
                  }}
                  style={buttonStyle()}
                >
                  Edit Recipes
                </button>

                <button
                  onClick={() => {
                    navigate(`/admin/users?return=part`);
                  }}
                  style={buttonStyle()}
                >
                  Manage Users
                </button>

                <button
                  onClick={() => {
                    navigate(`/admin/parts?return=part`);
                  }}
                  style={buttonStyle()}
                >
                  Manage Parts
                </button>
              </div>
            </Card>
          )}

          <ProgramProgressCard
            paths={paths}
            programProgress={programProgress}
            opcConnected={opcConnected}
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          />
        </div>
      </div>

      {saveRecipeOpen && canSaveRecipe && (
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

function ZoneCanvas({
  imageUrl,
  imageSize,
  zones,
  zoneState,
  toggleZone,
  hoveredZone,
  setHoveredZone,
  isZoneAvailable,
  sections = [],
  sectionState = {},
  sectionSources = {},
}) {
  const containerRef = useRef(null);
  const [fitSize, setFitSize] = useState({ width: 0, height: 0 });

  const sourceWidth = imageSize?.width || 1920;
  const sourceHeight = imageSize?.height || 1080;

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
          src={imageUrl}
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
          {sections
            .filter((s) => sectionState[s.slot])
            .map((s) => {
              const memberZones = (zones || []).filter((z) => s.zone_ids.includes(z.zone_id));
              const d = unionOfZones(memberZones);
              if (!d) return null;
              const color = SLOT_COLORS[s.slot];
              return (
                <path
                  key={`section-union-${s.slot}`}
                  d={d}
                  fill={color.fill}
                  stroke={color.stroke}
                  strokeWidth="4"
                  style={{ pointerEvents: "none" }}
                />
              );
            })}
          {(zones || []).map((z) => {
            const active = !!zoneState[z.zone_id];
            const hovered = hoveredZone === z.zone_id;
            const available = isZoneAvailable(z);

            // Check if this zone is locked by an active section
            let lockedBySection = null;
            for (const s of sections) {
              if (sectionState[s.slot] && s.zone_ids.includes(z.zone_id)) {
                lockedBySection = s.slot;
                break;
              }
            }

            const fill = lockedBySection
              ? "none"
              : active
                ? "rgba(22,163,74,0.55)"
                : !available
                  ? "rgba(107,114,128,0.10)"
                  : hovered
                    ? "rgba(59,130,246,0.55)"
                    : "rgba(59,130,246,0.38)";

            const stroke = lockedBySection
              ? "none"
              : active
                ? "#15803d"
                : !available
                  ? "rgba(107,114,128,0.30)"
                  : hovered
                    ? "#1d4ed8"
                    : "#2563eb";

            const strokeWidth = lockedBySection ? "0" : active ? "3" : available ? "3" : "1.5";
            const isAutoSection = lockedBySection && sectionSources[lockedBySection] === "auto";
            const locked = (!!lockedBySection && !isAutoSection) || !available;

            return (
              <polygon
                key={z.zone_id}
                points={z.points.map((p) => p.join(",")).join(" ")}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                pointerEvents="all"
                onClick={() => {
                  if (locked) return;
                  toggleZone(z.zone_id);
                }}
                onMouseEnter={() => setHoveredZone(z.zone_id)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{
                  cursor: locked ? "not-allowed" : "pointer",
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

function Card({ title, children, style: extraStyle, headerRight }) {
  return (
    <div
      style={{
        border: "1px solid #d1d5db",
        borderRadius: 14,
        background: "#fff",
        padding: 10,
        width: "100%",
        boxSizing: "border-box",
        ...extraStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>
          {title}
        </div>
        {headerRight}
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

function ProgramProgressCard({ paths, programProgress, opcConnected, style: extraStyle }) {
  const activeSteps = (paths || []).filter((p) => (p.passes ?? 0) > 0);
  const { running, stepIndex, passCount } = programProgress;

  const currentStep = running ? activeSteps[stepIndex] : null;
  const totalPasses = currentStep?.passes ?? 0;
  const grit = currentStep?.grit ?? null;
  const displayStep = running ? stepIndex + 1 : null;
  const activePathIndex = running ? getActivePathIndex(paths, stepIndex) : -1;

  const vbSize = 120;
  const strokeWidth = 10;
  const radius = (vbSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = totalPasses > 0 ? Math.min(passCount / totalPasses, 1) : 0;
  const dashOffset = circumference * (1 - progress);

  const idle = !opcConnected || !running;
  const ringColor = idle ? "#e5e7eb" : "#2563eb";
  const trackColor = "#f1f5f9";

  return (
    <Card title="Program Progress" style={{ ...extraStyle, overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: vbSize }}>
          <svg
            viewBox={`0 0 ${vbSize} ${vbSize}`}
            width="100%"
            style={{ display: "block", transform: "rotate(-90deg)" }}
          >
            <circle
              cx={vbSize / 2}
              cy={vbSize / 2}
              r={radius}
              fill="none"
              stroke={trackColor}
              strokeWidth={strokeWidth}
            />
            <circle
              cx={vbSize / 2}
              cy={vbSize / 2}
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ transition: "stroke-dashoffset 0.15s ease, stroke 0.2s ease" }}
            />
          </svg>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            {idle ? (
              <span style={{ fontSize: 22, fontWeight: 700, color: "#9ca3af" }}>—</span>
            ) : (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", lineHeight: 1 }}>
                  Step {displayStep}
                </span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#1e3a5f", lineHeight: 1 }}>
                  {activePathIndex === 3 ? "Scotch" : grit != null ? `P${grit}` : "—"}
                </span>
                <span style={{ fontSize: 11, color: "#6b7280", lineHeight: 1, marginTop: 1 }}>
                  {passCount} / {totalPasses}
                </span>
              </>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: idle ? "#9ca3af" : "#374151", fontWeight: 600, flex: "0 0 auto" }}>
          {!opcConnected
            ? "OPC Disconnected"
            : running
            ? "Program Running"
            : "Idle"}
        </div>
      </div>
    </Card>
  );
}

const backLinkStyle = {
  color: "#2563eb",
  textDecoration: "none",
  fontSize: 18,
  fontWeight: 700,
};
