import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

export default function PartsGrid() {
  const [parts, setParts] = useState([])
  const [error, setError] = useState("")
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function run() {
      setError("")
      try {
        const res = await fetch("/api/parts")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setParts(data)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ padding: 24, fontFamily: "Arial" }}>
      <h1 style={{ marginTop: 0 }}>Parts</h1>

      {error && (
        <div style={{ padding: 12, border: "1px solid #f99", marginBottom: 16 }}>
          Failed to load parts: {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 220px)",
          gap: 16,
        }}
      >
        {parts.map((p) => (
          <button
            key={p.part_id}
            onClick={() => navigate(`/part/${p.part_id}`)}
            style={{
              textAlign: "left",
              border: "1px solid #ccc",
              padding: 10,
              cursor: "pointer",
              background: "white",
            }}
          >
            <div
              style={{
                width: 200,
                height: 150,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <img
                src={p.thumb_url}
                alt={p.display_name}
                style={{ maxWidth: "100%", maxHeight: "100%" }}
              />
            </div>

            <div style={{ fontWeight: 600 }}>{p.display_name}</div>

            {!p.configured && (
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Zones not configured
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}