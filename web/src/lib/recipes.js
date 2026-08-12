export function getDefaultPaths() {
  return [
    { passes: 0, grit: 80, force: 10 },
    { passes: 0, grit: 120, force: 10 },
    { passes: 0, grit: 180, force: 10 },
    { passes: 0, force: 10 },
  ];
}

export function normalizePaths(rawPaths) {
  const defaults = getDefaultPaths();

  if (!Array.isArray(rawPaths)) {
    return defaults;
  }

  return defaults.map((defaultPath, index) => {
    const raw = rawPaths[index] && typeof rawPaths[index] === "object" ? rawPaths[index] : {};

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

export function createEmptyZoneState() {
  const next = {};
  for (let i = 1; i <= 40; i++) next[i] = false;
  return next;
}

// Returns a zone map {1..40: bool} from raw zones object
export function normalizeZoneMap(rawZones) {
  const next = createEmptyZoneState();

  if (!rawZones || typeof rawZones !== "object") {
    return next;
  }

  for (let i = 1; i <= 40; i++) {
    next[i] = !!(rawZones[i] || rawZones[String(i)]);
  }

  return next;
}

// Returns an array of active zone IDs from raw zones object
export function normalizeZoneIds(rawZones) {
  const ids = [];

  if (!rawZones || typeof rawZones !== "object") {
    return ids;
  }

  for (let i = 1; i <= 40; i++) {
    if (rawZones[i] || rawZones[String(i)]) {
      ids.push(i);
    }
  }

  return ids;
}

// Maps a stepIndex (into the filtered active-paths array) back to its original path index (0–3).
// Returns -1 if not found.
export function getActivePathIndex(paths, stepIndex) {
  if (!Array.isArray(paths) || stepIndex < 0) return -1;
  let activeCount = 0;
  for (let i = 0; i < paths.length; i++) {
    if ((paths[i]?.passes ?? 0) > 0) {
      if (activeCount === stepIndex) return i;
      activeCount++;
    }
  }
  return -1;
}

// Converts an array of zone IDs back to a zone map
export function zoneIdsToMap(zoneIds) {
  const zoneMap = createEmptyZoneState();

  for (const zoneId of zoneIds) {
    if (Number.isInteger(zoneId) && zoneId >= 1 && zoneId <= 40) {
      zoneMap[zoneId] = true;
    }
  }

  return zoneMap;
}
