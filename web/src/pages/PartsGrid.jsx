import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function PartsGrid() {
  const [parts, setParts] = useState([]);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setError("");
      try {
        const res = await fetch("/api/parts");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setParts(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100%",
        padding: "12px 24px 28px",
        fontFamily: "Arial, sans-serif",
        boxSizing: "border-box",
        color: "#1f2937",
        width: "100%",
      }}
    >
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            Parts
          </h1>
          <div
            style={{
              marginTop: 6,
              fontSize: 14,
              color: "#6b7280",
            }}
          >
            Select a part to view and apply zones
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 14,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 12,
            marginBottom: 20,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Failed to load parts: {error}
        </div>
      )}

      {parts.length === 0 && !error ? (
        <div
          style={{
            border: "1px solid #e5e7eb",
            background: "#ffffff",
            borderRadius: 16,
            padding: 24,
            color: "#6b7280",
            fontSize: 15,
          }}
        >
          Loading parts...
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 18,
            alignItems: "stretch",
          }}
        >
          {parts.map((p) => {
            const isConfigured = !!p.configured;

            return (
              <button
                key={p.part_id}
                onClick={() => navigate(`/part/${p.part_id}`)}
                style={{
                  textAlign: "left",
                  border: "1px solid #d1d5db",
                  borderRadius: 16,
                  padding: 14,
                  cursor: "pointer",
                  background: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                  transition:
                    "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
                  e.currentTarget.style.borderColor = "#93c5fd";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "4 / 3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    borderRadius: 12,
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <img
                    src={p.thumb_url}
                    alt={p.display_name}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </div>

                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 17,
                      color: "#111827",
                      lineHeight: 1.25,
                      marginBottom: 6,
                    }}
                  >
                    {p.display_name}
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#6b7280",
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        background: "#f3f4f6",
                        borderRadius: 999,
                        padding: "4px 8px",
                        fontWeight: 600,
                      }}
                    >
                      {p.section_count} section{p.section_count === 1 ? "" : "s"}
                    </span>

                    <span
                      style={{
                        background: isConfigured ? "#dcfce7" : "#fef3c7",
                        color: isConfigured ? "#166534" : "#92400e",
                        borderRadius: 999,
                        padding: "4px 8px",
                        fontWeight: 700,
                      }}
                    >
                      {isConfigured ? "Configured" : "Needs setup"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}