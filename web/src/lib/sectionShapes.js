import polygonClipping from "polygon-clipping";

function dilatePolygon(points, amount = 4) {
  const n = points.length;
  if (n === 0) return points;
  const cx = points.reduce((s, p) => s + Number(p[0]), 0) / n;
  const cy = points.reduce((s, p) => s + Number(p[1]), 0) / n;
  return points.map((p) => {
    const dx = Number(p[0]) - cx;
    const dy = Number(p[1]) - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [Number(p[0]) + (dx / len) * amount, Number(p[1]) + (dy / len) * amount];
  });
}

function toClosedRing(points) {
  const ring = points.map((p) => [Number(p[0]), Number(p[1])]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

function multiPolygonToSvgPath(multiPolygon) {
  if (!multiPolygon || multiPolygon.length === 0) return null;
  let d = "";
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      if (ring.length === 0) continue;
      d += `M ${ring[0][0]} ${ring[0][1]}`;
      for (let i = 1; i < ring.length; i++) {
        d += ` L ${ring[i][0]} ${ring[i][1]}`;
      }
      d += " Z ";
    }
  }
  return d.trim() || null;
}

export function unionOfZones(zoneObjects) {
  if (!zoneObjects || zoneObjects.length === 0) return null;

  const validZones = zoneObjects.filter(
    (z) => z && z.points && z.points.length >= 3,
  );
  if (validZones.length === 0) return null;

  if (validZones.length === 1) {
    const pts = validZones[0].points;
    return `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(" L ")} Z`;
  }

  try {
    const polys = validZones.map((z) => [toClosedRing(dilatePolygon(z.points))]);
    const result = polygonClipping.union(...polys);
    return multiPolygonToSvgPath(result);
  } catch {
    // Fallback: concatenate individual zone paths
    return validZones
      .map((z) => `M ${z.points.map((p) => `${p[0]} ${p[1]}`).join(" L ")} Z`)
      .join(" ");
  }
}
