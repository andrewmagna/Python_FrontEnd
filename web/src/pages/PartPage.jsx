import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";

const ORIENTATION_LABELS = {
  1: "0°",
  2: "90°",
  3: "180°",
  4: "270°",
};

const HEADER_HEIGHT = 96;

export default function PartPage() {
  const { partId } = useParams();

  const [part, setPart] = useState(null);
  const [zoneState, setZoneState] = useState({});
  const [hoveredZone, setHoveredZone] = useState(null);
  const [opcConnected, setOpcConnected] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [tableOrientation, setTableOrientation] = useState(null);
  const [tableOrientationDegrees, setTableOrientationDegrees] = useState(null);
  const [debugOrientationOverride, setDebugOrientationOverride] =
    useState("live");
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/parts/${partId}`);
      const data = await res.json();

      setPart(data);

      const z = {};
      for (let i = 1; i <= 40; i++) z[i] = false;
      setZoneState(z);
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
        }
      } catch {
        if (!cancelled) {
          setOpcConnected(false);
          setTableOrientation(null);
          setTableOrientationDegrees(null);
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

  const effectiveOrientation =
    debugOrientationOverride === "live"
      ? tableOrientation
      : Number(debugOrientationOverride);

  const totalZoneCount = useMemo(() => {
    if (!part || !Array.isArray(part.sections)) return 0;

    return part.sections.reduce((count, section) => {
      return count + (Array.isArray(section.zones) ? section.zones.length : 0);
    }, 0);
  }, [part]);

  const needsZoneSetup = useMemo(() => {
    if (!part) return false;
    if (part.configured === false) return true;
    if (!Array.isArray(part.sections) || part.sections.length === 0) return true;
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

  function toggleZone(id) {
    if (!validZoneIds.has(id)) return;

    setZoneState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  function clearAll() {
    const z = {};
    for (let i = 1; i <= 40; i++) z[i] = false;
    setZoneState(z);
  }

  function selectAllAvailable() {
    setZoneState((prev) => {
      const next = { ...prev };
      for (const zoneId of validZoneIds) {
        next[zoneId] = true;
      }
      return next;
    });
  }

  async function applyZones() {
    try {
      setApplyBusy(true);

      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part_id: partId,
          zones: zoneState,
        }),
      });

      if (!res.ok) {
        let msg = "Apply failed";
        try {
          const err = await res.json();
          msg = err.detail || msg;
        } catch {}
        alert(msg);
        return;
      }

      alert("Zones applied successfully");
    } catch {
      alert("Server error");
    } finally {
      setApplyBusy(false);
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
          <Link to="/" style={backLinkStyle}>
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
        <Link to="/" style={backLinkStyle}>
          ← <span style={{ verticalAlign: "middle" }}>Back to Parts</span>
        </Link>
      </div>

      <div style={{ marginBottom: 8, flex: "0 0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>{part.display_name}</h1>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(0, 1fr) 300px",
          gap: 14,
          alignItems: "stretch",
          width: "100%",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
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
              <button onClick={clearAll} style={buttonStyle()}>
                Clear All
              </button>

              <button
                onClick={selectAllAvailable}
                disabled={validZoneIds.size === 0}
                title={
                  validZoneIds.size === 0
                    ? "No zones available for current orientation"
                    : ""
                }
                style={buttonStyle(validZoneIds.size === 0)}
              >
                Select All Available
              </button>

              <button
                onClick={applyZones}
                disabled={!opcConnected || applyBusy}
                title={!opcConnected ? "OPC disconnected" : ""}
                style={primaryButtonStyle(!opcConnected || applyBusy)}
              >
                {applyBusy ? "Applying..." : "Apply"}
              </button>
            </div>
          </Card>

          <Card title="Debug">
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#4b5563" }}>
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
            <button
              onClick={() => {
                window.location.href = `/admin/editor/${part.part_id}/1?return=part`;
              }}
              style={buttonStyle()}
            >
              Edit Zones
            </button>
          </Card>
        </div>
      </div>
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
                  ? "rgba(59,130,246,0.18)"
                  : "rgba(107,114,128,0.05)";

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
        padding: 12,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 15,
          marginBottom: 12,
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