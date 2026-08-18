import { useEffect, useRef, useState } from "react";
import { useProgramProgress } from "../hooks/useProgramProgress.js";
import { getDefaultPaths } from "../lib/recipes.js";

const HEADER_HEIGHT = 96;
const ORIENTATION_LABELS = { 1: "0°", 2: "90°", 3: "180°", 4: "270°" };

function StandbyScreen() {
  return (
    <div
      style={{
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #d1d5db",
          borderRadius: 20,
          boxShadow: "0 8px 32px rgba(15,23,42,0.08)",
          padding: "48px 56px",
          textAlign: "center",
          maxWidth: 520,
        }}
      >
        <div
          style={{
            fontSize: "clamp(24px, 4vh, 56px)",
            fontWeight: 800,
            color: "#111827",
            marginBottom: 16,
            lineHeight: 1.1,
          }}
        >
          Waiting for login
        </div>
        <div
          style={{
            fontSize: "clamp(14px, 2vh, 28px)",
            color: "#6b7280",
            fontWeight: 500,
          }}
        >
          Log in on the main screen to resume
        </div>
      </div>
    </div>
  );
}

export default function SummaryPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [activePart, setActivePart] = useState(null);
  const [paths, setPaths] = useState(() => getDefaultPaths());
  const [opcConnected, setOpcConnected] = useState(false);
  const [tableOrientation, setTableOrientation] = useState(null);
  const [tableOrientationDegrees, setTableOrientationDegrees] = useState(null);

  const pathsRef = useRef(getDefaultPaths());
  const rightColRef = useRef(null);
  const ringTitleRef = useRef(null);
  const ringPillRef = useRef(null);
  const [ringSize, setRingSize] = useState(200);
  const cardsContainerRef = useRef(null);
  const [cardH, setCardH] = useState(120);

  // Keep pathsRef in sync so the progress hook always reads the latest paths
  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // Ring sizing via ResizeObserver on the right column container.
  // Deps include sessionLoaded+authenticated so the effect re-runs once the
  // live layout renders (rightColRef is null during standby/loading).
  useEffect(() => {
    if (!sessionLoaded || !authenticated) return;
    const el = rightColRef.current;
    if (!el) return;

    function update() {
      const b = el.getBoundingClientRect();
      const titleH = ringTitleRef.current
        ? ringTitleRef.current.getBoundingClientRect().height + 16
        : 40;
      const pillH = ringPillRef.current
        ? ringPillRef.current.getBoundingClientRect().height + 16
        : 60;
      const vertPad = 32;
      const available = Math.min(b.width - 36, b.height - vertPad - titleH - pillH);
      setRingSize(Math.max(120, available));
    }

    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [sessionLoaded, authenticated]);

  // Card height measurement — drives font sizes inside each recipe card
  useEffect(() => {
    if (!sessionLoaded || !authenticated) return;
    const el = cardsContainerRef.current;
    if (!el) return;

    function update() {
      const { height } = el.getBoundingClientRect();
      // 4 cards separated by 3 gaps of 8px
      setCardH(Math.max(60, (height - 24) / 4));
    }

    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [sessionLoaded, authenticated]);

  // Session poll every 2.5 s — drives the standby / live toggle
  useEffect(() => {
    let cancelled = false;

    async function pollSession() {
      try {
        const res = await fetch(`/api/session?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled) {
          setAuthenticated(!!data.authenticated);
          setSessionLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          setSessionLoaded(true);
        }
      }
    }

    pollSession();
    const t = setInterval(pollSession, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Active part + last-state poll (gated on auth)
  useEffect(() => {
    if (!authenticated) {
      setActivePart(null);
      setPaths(getDefaultPaths());
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const partRes = await fetch(`/api/active-part?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!partRes.ok || cancelled) return;
        const partData = await partRes.json();

        if (!cancelled) setActivePart(partData.part_id ? partData : null);

        if (partData.part_id) {
          const lsRes = await fetch(
            `/api/parts/${partData.part_id}/last-state?t=${Date.now()}`,
            { cache: "no-store" },
          );
          if (!lsRes.ok || cancelled) return;
          const lsData = await lsRes.json();
          if (!cancelled && Array.isArray(lsData?.paths) && lsData.paths.length > 0) {
            setPaths(lsData.paths);
          }
        } else {
          if (!cancelled) setPaths(getDefaultPaths());
        }
      } catch {
        // silently ignore while transitioning auth state
      }
    }

    poll();
    const t = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [authenticated]);

  // OPC connection status poll (gated on auth)
  useEffect(() => {
    if (!authenticated) {
      setOpcConnected(false);
      return;
    }

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
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [authenticated]);

  // Orientation poll (gated on auth + OPC connected)
  useEffect(() => {
    if (!authenticated || !opcConnected) {
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
  }, [authenticated, opcConnected]);

  // Program progress — hook reads from pathsRef so path changes don't reset it
  const programProgress = useProgramProgress(
    authenticated && opcConnected,
    pathsRef,
  );

  if (!sessionLoaded) return null;
  if (!authenticated) return <StandbyScreen />;

  const orientationText =
    tableOrientationDegrees != null
      ? `${tableOrientationDegrees}°`
      : ORIENTATION_LABELS[tableOrientation] || "—";

  const activeSteps = paths.filter((p) => (p.passes ?? 0) > 0);
  const { running, stepIndex, passCount } = programProgress;
  const currentActiveStep = running ? activeSteps[stepIndex] : null;

  // Map active step index back to original path index for highlighting + Scotch detection
  let activePathIndex = null;
  if (running && currentActiveStep) {
    let count = 0;
    for (let i = 0; i < paths.length; i++) {
      if ((paths[i].passes ?? 0) > 0) {
        if (count === stepIndex) {
          activePathIndex = i;
          break;
        }
        count++;
      }
    }
  }

  const isScotch = activePathIndex === 3;
  const totalPasses = currentActiveStep?.passes ?? 0;
  const progress = totalPasses > 0 ? Math.min(passCount / totalPasses, 1) : 0;

  // Card font sizes — derived from measured card height so they fill the card
  const cardLabelSize = Math.max(16, Math.min(cardH * 0.22, 44));
  const cardNumSize   = Math.max(22, Math.min(cardH * 0.46, 86));
  const cardCaptSize  = Math.max(10, Math.min(cardH * 0.12, 22));
  const cardUnitSize  = Math.max(10, Math.min(cardH * 0.16, 30));
  const cardPad       = Math.max(8,  Math.min(cardH * 0.08, 18));

  // Ring SVG geometry — viewBox stays fixed so stroke math is correct
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
      {/* Top bar — part name + table orientation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            fontSize: "clamp(16px, 3vh, 48px)",
            fontWeight: 800,
            color: "#111827",
            lineHeight: 1,
          }}
        >
          {activePart?.display_name ?? "No part selected"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1 }}>
          <span
            style={{
              fontSize: "clamp(12px, 1.8vh, 22px)",
              fontWeight: 600,
              color: "#6b7280",
              marginBottom: 2,
            }}
          >
            Table Orientation
          </span>
          <span
            style={{
              fontSize: "clamp(28px, 6vh, 72px)",
              fontWeight: 800,
              color: opcConnected && tableOrientation ? "#1f2937" : "#9ca3af",
              lineHeight: 1,
            }}
          >
            {opcConnected ? orientationText : "—"}
          </span>
        </div>
      </div>

      {/* Main content — two equal columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* LEFT — Recipe Setup: 4 cards that fill the column equally */}
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
          <div
            style={{
              fontSize: "clamp(12px, 1.6vh, 24px)",
              fontWeight: 700,
              color: "#111827",
              marginBottom: 10,
              flex: "0 0 auto",
            }}
          >
            Recipe Setup
          </div>
          <div
            ref={cardsContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {paths.map((p, i) => {
              const isActive = i === activePathIndex;
              const isInactive = (p.passes ?? 0) === 0;
              const gritLabel = i < 3 ? `P${p.grit}` : "Scotch";
              const label = `Step ${i + 1} — ${gritLabel}`;

              return (
                <div
                  key={i}
                  style={{
                    border: isActive
                      ? "2px solid #2563eb"
                      : "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: `${cardPad}px ${cardPad * 1.2}px`,
                    background: isActive
                      ? "#eff6ff"
                      : isInactive
                        ? "#f9fafb"
                        : "#fff",
                    opacity: isInactive ? 0.5 : 1,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    transition: "border-color 0.15s, background 0.15s",
                    minHeight: 0,
                    overflow: "hidden",
                  }}
                >
                  {/* Step label — top, left-aligned */}
                  <div
                    style={{
                      fontSize: cardLabelSize,
                      fontWeight: 700,
                      color: isActive
                        ? "#1d4ed8"
                        : isInactive
                          ? "#9ca3af"
                          : "#111827",
                      lineHeight: 1,
                    }}
                  >
                    {label}
                  </div>

                  {/* Stat blocks — spread full card width */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      width: "100%",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: cardCaptSize,
                          fontWeight: 600,
                          color: "#6b7280",
                          marginBottom: 2,
                          letterSpacing: "0.05em",
                        }}
                      >
                        PASSES
                      </div>
                      <div
                        style={{
                          fontSize: cardNumSize,
                          fontWeight: 800,
                          color: isInactive ? "#d1d5db" : "#111827",
                          lineHeight: 1,
                        }}
                      >
                        {p.passes ?? 0}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: cardCaptSize,
                          fontWeight: 600,
                          color: "#6b7280",
                          marginBottom: 2,
                          letterSpacing: "0.05em",
                        }}
                      >
                        FORCE
                      </div>
                      <div
                        style={{
                          fontSize: cardNumSize,
                          fontWeight: 800,
                          color: isInactive ? "#d1d5db" : "#111827",
                          lineHeight: 1,
                        }}
                      >
                        {p.force ?? 10}
                        <span
                          style={{
                            fontSize: cardUnitSize,
                            fontWeight: 600,
                          }}
                        >
                          {" "}N
                        </span>
                      </div>
                    </div>
                    {isActive ? (
                      <div>
                        <div
                          style={{
                            fontSize: cardCaptSize,
                            fontWeight: 600,
                            color: "#6b7280",
                            marginBottom: 2,
                            letterSpacing: "0.05em",
                          }}
                        >
                          PROGRESS
                        </div>
                        <div
                          style={{
                            fontSize: cardNumSize,
                            fontWeight: 800,
                            color: "#2563eb",
                            lineHeight: 1,
                          }}
                        >
                          {passCount}
                          <span
                            style={{
                              fontSize: cardUnitSize,
                              fontWeight: 600,
                              color: "#6b7280",
                            }}
                          >
                            {" "}/ {totalPasses}
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* placeholder keeps PASSES and FORCE from shifting when PROGRESS appears */
                      <div style={{ visibility: "hidden" }}>
                        <div style={{ fontSize: cardCaptSize, marginBottom: 2 }}>PROGRESS</div>
                        <div style={{ fontSize: cardNumSize, lineHeight: 1 }}>0</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — Progress ring, dynamically sized */}
        <div
          ref={rightColRef}
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
          <div
            ref={ringTitleRef}
            style={{
              fontSize: "clamp(12px, 1.6vh, 24px)",
              fontWeight: 700,
              color: "#111827",
              marginBottom: 16,
              flex: "0 0 auto",
            }}
          >
            Program Progress
          </div>

          <div
            style={{
              position: "relative",
              width: ringSize,
              height: ringSize,
              flex: "0 0 auto",
            }}
          >
            <svg
              viewBox={`0 0 ${vbSize} ${vbSize}`}
              width={ringSize}
              height={ringSize}
              style={{ display: "block", transform: "rotate(-90deg)" }}
            >
              <circle
                cx={vbSize / 2}
                cy={vbSize / 2}
                r={radius}
                fill="none"
                stroke="#f1f5f9"
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
                style={{
                  transition: "stroke-dashoffset 0.15s ease, stroke 0.2s ease",
                }}
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
                <span
                  style={{
                    fontSize: ringSize * 0.18,
                    fontWeight: 700,
                    color: "#d1d5db",
                  }}
                >
                  —
                </span>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: Math.max(10, ringSize * 0.07),
                      fontWeight: 700,
                      color: "#6b7280",
                      lineHeight: 1,
                    }}
                  >
                    Step {stepIndex + 1}
                  </span>
                  <span
                    style={{
                      fontSize: Math.max(14, ringSize * 0.14),
                      fontWeight: 800,
                      color: "#1e3a5f",
                      lineHeight: 1,
                    }}
                  >
                    {isScotch
                      ? "Scotch"
                      : currentActiveStep?.grit != null
                        ? `P${currentActiveStep.grit}`
                        : "—"}
                  </span>
                  <span
                    style={{
                      fontSize: Math.max(10, ringSize * 0.08),
                      color: "#6b7280",
                      lineHeight: 1,
                      marginTop: 2,
                    }}
                  >
                    {passCount} / {totalPasses}
                  </span>
                </>
              )}
            </div>
          </div>

          <div
            ref={ringPillRef}
            style={{
              marginTop: 16,
              fontSize: "clamp(12px, 1.6vh, 22px)",
              fontWeight: 700,
              color: !opcConnected ? "#ef4444" : running ? "#166534" : "#6b7280",
              background: !opcConnected
                ? "#fee2e2"
                : running
                  ? "#dcfce7"
                  : "#f3f4f6",
              borderRadius: 999,
              padding: "clamp(6px, 0.8vh, 12px) clamp(12px, 1.5vh, 24px)",
              flex: "0 0 auto",
            }}
          >
            {!opcConnected
              ? "OPC Disconnected"
              : running
                ? "Program Running"
                : "Idle"}
          </div>
        </div>
      </div>
    </div>
  );
}
