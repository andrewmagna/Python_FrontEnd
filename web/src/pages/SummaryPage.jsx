import { useEffect, useRef, useState } from "react";

const HEADER_HEIGHT = 96;

const ORIENTATION_LABELS = { 1: "0°", 2: "90°", 3: "180°", 4: "270°" };

function getDefaultPaths() {
  return [
    { passes: 0, grit: 80, force: 10 },
    { passes: 0, grit: 120, force: 10 },
    { passes: 0, grit: 180, force: 10 },
    { passes: 0, force: 10 },
  ];
}

export default function SummaryPage() {
  const [activePart, setActivePart] = useState(null);
  const [paths, setPaths] = useState(getDefaultPaths());
  const [opcConnected, setOpcConnected] = useState(false);
  const [tableOrientation, setTableOrientation] = useState(null);
  const [tableOrientationDegrees, setTableOrientationDegrees] = useState(null);
  const [programProgress, setProgramProgress] = useState({ running: false, stepIndex: 0, passCount: 0 });

  const pathsRef = useRef(getDefaultPaths());
  const programStateRef = useRef({
    prevProgramStarted: false,
    prevCycleStarted: false,
    prevCycleCompleted: false,
    stepIndex: 0,
    passCount: 0,
  });

  // Keep pathsRef in sync without restarting the program poll
  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // Poll active part + last state every 2s
  useEffect(() => {
    let cancelled = false;
    let lastPartId = null;

    async function poll() {
      try {
        const partRes = await fetch(`/api/active-part?t=${Date.now()}`, { cache: "no-store" });
        if (!partRes.ok || cancelled) return;
        const partData = await partRes.json();

        if (!cancelled) {
          setActivePart(partData.part_id ? partData : null);
        }

        if (partData.part_id) {
          // Re-fetch paths when part changes or on every tick (catches operator edits)
          if (partData.part_id !== lastPartId || true) {
            lastPartId = partData.part_id;
            const lsRes = await fetch(`/api/parts/${partData.part_id}/last-state?t=${Date.now()}`, { cache: "no-store" });
            if (!lsRes.ok || cancelled) return;
            const lsData = await lsRes.json();
            if (!cancelled && Array.isArray(lsData?.paths) && lsData.paths.length > 0) {
              setPaths(lsData.paths);
            }
          }
        } else {
          lastPartId = null;
          if (!cancelled) setPaths(getDefaultPaths());
        }
      } catch {
        // ignore
      }
    }

    poll();
    const t = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // OPC connection status poll
  useEffect(() => {
    let cancelled = false;
    let t = null;
    const connectedRef = { current: false };

    async function poll() {
      try {
        const res = await fetch(`/api/opc/status?t=${Date.now()}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          const nowConnected = !!data.connected;
          setOpcConnected(nowConnected);
          if (nowConnected !== connectedRef.current) {
            connectedRef.current = nowConnected;
            clearInterval(t);
            t = setInterval(poll, nowConnected ? 150 : 2000);
          }
        }
      } catch {
        if (!cancelled) {
          setOpcConnected(false);
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
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Orientation poll — dedicated 150ms when connected
  useEffect(() => {
    if (!opcConnected) {
      setTableOrientation(null);
      setTableOrientationDegrees(null);
      return;
    }

    let cancelled = false;

    async function pollOrientation() {
      try {
        const res = await fetch(`/api/opc/orientation?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setTableOrientation([1, 2, 3, 4].includes(data.orientation) ? data.orientation : null);
          setTableOrientationDegrees(typeof data.degrees === "number" ? data.degrees : null);
        }
      } catch {
        if (!cancelled) { setTableOrientation(null); setTableOrientationDegrees(null); }
      }
    }

    pollOrientation();
    const t = setInterval(pollOrientation, 150);
    return () => { cancelled = true; clearInterval(t); };
  }, [opcConnected]);

  // Program progress poll — 100ms, uses pathsRef to avoid resetting on path changes
  useEffect(() => {
    if (!opcConnected) {
      programStateRef.current = { prevProgramStarted: false, prevCycleStarted: false, prevCycleCompleted: false, stepIndex: 0, passCount: 0 };
      setProgramProgress({ running: false, stepIndex: 0, passCount: 0 });
      return;
    }

    let cancelled = false;

    async function pollProgram() {
      try {
        const res = await fetch(`/api/opc/program-status?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();

        const ps = !!data.program_started;
        const cs = !!data.cycle_started;
        const cc = !!data.cycle_completed;
        const ref = programStateRef.current;
        const activePaths = (pathsRef.current || []).filter((p) => (p.passes ?? 0) > 0);

        let { stepIndex, passCount } = ref;

        if (ps && !ref.prevProgramStarted) {
          stepIndex = 0;
          passCount = 0;
        } else if (ps) {
          if (cs && !ref.prevCycleStarted) {
            passCount += 1;
          }
          if (cc && !ref.prevCycleCompleted) {
            const currentStep = activePaths[stepIndex];
            if (currentStep && passCount >= currentStep.passes) {
              let next = stepIndex + 1;
              while (next < activePaths.length && (activePaths[next].passes ?? 0) === 0) next++;
              stepIndex = next < activePaths.length ? next : stepIndex;
              passCount = 0;
            }
          }
        }

        programStateRef.current = { prevProgramStarted: ps, prevCycleStarted: cs, prevCycleCompleted: cc, stepIndex, passCount };
        if (!cancelled) setProgramProgress({ running: ps, stepIndex, passCount });
      } catch {
        // ignore
      }
    }

    pollProgram();
    const t = setInterval(pollProgram, 100);
    return () => { cancelled = true; clearInterval(t); };
  }, [opcConnected]);

  const orientationText = tableOrientationDegrees != null
    ? `${tableOrientationDegrees}°`
    : ORIENTATION_LABELS[tableOrientation] || "—";

  const activeSteps = paths.filter((p) => (p.passes ?? 0) > 0);
  const { running, stepIndex, passCount } = programProgress;
  const currentActiveStep = running ? activeSteps[stepIndex] : null;

  // Map activeStep index back to original path index for highlighting
  let activePathIndex = null;
  if (running && currentActiveStep) {
    let count = 0;
    for (let i = 0; i < paths.length; i++) {
      if ((paths[i].passes ?? 0) > 0) {
        if (count === stepIndex) { activePathIndex = i; break; }
        count++;
      }
    }
  }

  const totalPasses = currentActiveStep?.passes ?? 0;
  const progress = totalPasses > 0 ? Math.min(passCount / totalPasses, 1) : 0;

  // Ring geometry — larger than part page for 12" display
  const vbSize = 220;
  const strokeWidth = 16;
  const radius = (vbSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const idle = !opcConnected || !running;
  const ringColor = idle ? "#e5e7eb" : "#2563eb";

  return (
    <div
      style={{
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        display: "flex",
        flexDirection: "column",
        padding: "12px 20px 16px",
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
        overflow: "hidden",
      }}
    >
      {/* Top bar — part name + orientation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flex: "0 0 auto",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 800, color: "#111827", lineHeight: 1 }}>
          {activePart?.display_name ?? "No part selected"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#6b7280" }}>Table Orientation</span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: opcConnected && tableOrientation ? "#1f2937" : "#9ca3af",
              background: opcConnected && tableOrientation ? "#f3f4f6" : "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "6px 16px",
              minWidth: 64,
              textAlign: "center",
            }}
          >
            {opcConnected ? orientationText : "—"}
          </span>
        </div>
      </div>

      {/* Main content — two columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* LEFT — Recipe Setup */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 14, flex: "0 0 auto" }}>
            Recipe Setup
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            {paths.map((p, i) => {
              const isActive = i === activePathIndex;
              const isInactive = (p.passes ?? 0) === 0;
              const label = i < 3 ? `Step ${i + 1} — Grit ${p.grit}` : `Step ${i + 1} — Scotch`;

              return (
                <div
                  key={i}
                  style={{
                    border: isActive ? "2px solid #2563eb" : "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: "12px 16px",
                    background: isActive ? "#eff6ff" : isInactive ? "#f9fafb" : "#fff",
                    opacity: isInactive ? 0.5 : 1,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: isActive ? "#1d4ed8" : isInactive ? "#9ca3af" : "#111827",
                      marginBottom: 8,
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>PASSES</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: isInactive ? "#d1d5db" : "#111827" }}>
                        {p.passes ?? 0}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>FORCE</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: isInactive ? "#d1d5db" : "#111827" }}>
                        {p.force ?? 10}<span style={{ fontSize: 13, fontWeight: 600 }}> N</span>
                      </div>
                    </div>
                    {isActive && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", marginBottom: 2 }}>PROGRESS</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb" }}>
                          {passCount}<span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}> / {totalPasses}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — Progress ring */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 20 }}>
            Program Progress
          </div>

          <div style={{ position: "relative", width: "min(280px, 55%)" }}>
            <svg
              viewBox={`0 0 ${vbSize} ${vbSize}`}
              width="100%"
              style={{ display: "block", transform: "rotate(-90deg)" }}
            >
              <circle
                cx={vbSize / 2} cy={vbSize / 2} r={radius}
                fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth}
              />
              <circle
                cx={vbSize / 2} cy={vbSize / 2} r={radius}
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
                gap: 4,
              }}
            >
              {idle ? (
                <span style={{ fontSize: 36, fontWeight: 700, color: "#d1d5db" }}>—</span>
              ) : (
                <>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#6b7280", lineHeight: 1 }}>
                    Step {stepIndex + 1}
                  </span>
                  <span style={{ fontSize: 30, fontWeight: 800, color: "#1e3a5f", lineHeight: 1 }}>
                    {currentActiveStep?.grit != null ? `G${currentActiveStep.grit}` : "—"}
                  </span>
                  <span style={{ fontSize: 16, color: "#6b7280", lineHeight: 1, marginTop: 2 }}>
                    {passCount} / {totalPasses}
                  </span>
                </>
              )}
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              fontSize: 15,
              fontWeight: 700,
              color: !opcConnected ? "#ef4444" : running ? "#166534" : "#6b7280",
              background: !opcConnected ? "#fee2e2" : running ? "#dcfce7" : "#f3f4f6",
              borderRadius: 999,
              padding: "8px 20px",
            }}
          >
            {!opcConnected ? "OPC Disconnected" : running ? "Program Running" : "Idle"}
          </div>
        </div>
      </div>
    </div>
  );
}
