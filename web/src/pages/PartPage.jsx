import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"

export default function PartPage() {
  const { partId } = useParams()

  const [part, setPart] = useState(null)
  const [zoneState, setZoneState] = useState({})
  const [hoveredZone, setHoveredZone] = useState(null)
  const [opcConnected, setOpcConnected] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [showEditorSections, setShowEditorSections] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/parts/${partId}`)
      const data = await res.json()

      setPart(data)

      const z = {}
      for (let i = 1; i <= 40; i++) z[i] = false
      setZoneState(z)
    }

    load()
  }, [partId])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch("/api/opc/status")
        const data = await res.json()
        if (!cancelled) setOpcConnected(!!data.connected)
      } catch {
        if (!cancelled) setOpcConnected(false)
      }
    }

    poll()
    const t = setInterval(poll, 2000)

    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  function toggleZone(id) {
    setZoneState((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  function clearAll() {
    const z = {}
    for (let i = 1; i <= 40; i++) z[i] = false
    setZoneState(z)
  }

  async function applyZones() {
    try {
      setApplyBusy(true)

      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part_id: partId,
          zones: zoneState,
        }),
      })

      if (!res.ok) {
        let msg = "Apply failed"
        try {
          const err = await res.json()
          msg = err.detail || msg
        } catch {}
        alert(msg)
        return
      }

      alert("Zones applied successfully")
    } catch {
      alert("Server error")
    } finally {
      setApplyBusy(false)
    }
  }

  if (!part) return <div>Loading...</div>

  if (part && part.configured === false) {
    return (
      <div style={{ padding: 20 }}>
        <Link to="/">← Back</Link>
        <h1>{part.display_name}</h1>

        <div style={{ padding: 12, border: "1px solid #ccc", marginTop: 12 }}>
          Zones not configured for this part.
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Missing zone files for sections:{" "}
            {part.missing_zones_sections?.join(", ") || "unknown"}
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => {
                const missing = part.missing_zones_sections?.[0] || 1
                window.location.href = `/admin/editor/${part.part_id}/${missing}?return=grid`
              }}
            >
              Enter Admin Mode
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 20 }}>
      <Link to="/">← Back</Link>

      <h1>{part.display_name}</h1>

      <div style={{ marginTop: 8, marginBottom: 16 }}>
        OPC:{" "}
        <span style={{ fontWeight: 600 }}>
          {opcConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <button onClick={clearAll}>Clear All</button>

      <button
        onClick={applyZones}
        disabled={!opcConnected || applyBusy}
        style={{ marginLeft: 10 }}
        title={!opcConnected ? "OPC disconnected" : ""}
      >
        {applyBusy ? "Applying..." : "Apply"}
      </button>

      <button
        onClick={() => setShowEditorSections((prev) => !prev)}
        style={{ marginLeft: 10 }}
      >
        {showEditorSections ? "Close Editor Menu" : "Edit Zones"}
      </button>

      {showEditorSections && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #ccc",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 600, marginRight: 8 }}>Edit section:</div>

          {part.sections.map((section) => (
            <button
              key={section.index}
              onClick={() => {
                window.location.href = `/admin/editor/${part.part_id}/${section.index}?return=part`
              }}
            >
              Section {section.index}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginTop: 20,
        }}
      >
        {part.sections.map((section) => (
          <SectionViewer
            key={section.index}
            section={section}
            zoneState={zoneState}
            toggleZone={toggleZone}
            hoveredZone={hoveredZone}
            setHoveredZone={setHoveredZone}
          />
        ))}
      </div>
    </div>
  )
}

function SectionViewer({
  section,
  zoneState,
  toggleZone,
  hoveredZone,
  setHoveredZone,
}) {
  return (
    <div style={{ position: "relative" }}>
      <img src={section.image_url} style={{ width: "100%" }} />

      <svg
        viewBox="0 0 1920 1080"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {section.zones.map((z) => {
          const active = !!zoneState[z.zone_id]
          const hovered = hoveredZone === z.zone_id

          const fill = active
            ? "rgba(0,200,0,0.45)"
            : hovered
            ? "rgba(120,120,120,0.30)"
            : "rgba(120,120,120,0.05)"

          const stroke = active
            ? "rgba(0,160,0,0.95)"
            : hovered
            ? "rgba(90,90,90,0.8)"
            : "rgba(120,120,120,0.35)"

          return (
            <polygon
              key={z.zone_id}
              points={z.points.map((p) => p.join(",")).join(" ")}
              fill={fill}
              stroke={stroke}
              strokeWidth="2"
              onClick={() => toggleZone(z.zone_id)}
              onMouseEnter={() => setHoveredZone(z.zone_id)}
              onMouseLeave={() => setHoveredZone(null)}
              style={{
                cursor: "pointer",
                transition: "fill 0.12s ease, stroke 0.12s ease",
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}