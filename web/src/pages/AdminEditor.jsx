import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"

export default function AdminEditor() {
  const { partId, sectionIndex } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const returnTarget = searchParams.get("return") || "grid"

  const [admin, setAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [imageUrl, setImageUrl] = useState("")
  const [imageSize, setImageSize] = useState({ width: 1920, height: 1080 })
  const [zones, setZones] = useState([])
  const [draftPoints, setDraftPoints] = useState([])
  const [zoneIdInput, setZoneIdInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [availableSections, setAvailableSections] = useState([])
  const [selectedZoneId, setSelectedZoneId] = useState(null)
  const [selectedVertexIndex, setSelectedVertexIndex] = useState(null)
  const [renumberInput, setRenumberInput] = useState("")
  const [dragInfo, setDragInfo] = useState(null)
  const [unsavedChanges, setUnsavedChanges] = useState(false)
  const [suppressNextSvgClick, setSuppressNextSvgClick] = useState(false)
  const [editMode, setEditMode] = useState("move") // "move" | "insert"

  useEffect(() => {
    async function checkAndLoad() {
      setLoading(true)

      const statusRes = await fetch("/api/admin/status")
      const statusData = await statusRes.json()

      if (!statusData.admin) {
        const next = encodeURIComponent(
          `/admin/editor/${partId}/${sectionIndex}?return=${returnTarget}`
        )
        navigate(`/admin/login?next=${next}`)
        return
      }

      setAdmin(true)

      const partRes = await fetch(`/api/parts/${partId}`)
      if (partRes.ok) {
        const partData = await partRes.json()
        setAvailableSections((partData.sections || []).map((s) => s.index))
      }

      const res = await fetch(`/api/editor/parts/${partId}/sections/${sectionIndex}`)
      if (!res.ok) {
        alert("Failed to load editor section")
        setLoading(false)
        return
      }

      const data = await res.json()
      setImageUrl(data.image_url)
      setImageSize(data.image_size || { width: 1920, height: 1080 })
      setZones(data.zones || [])
      setDraftPoints([])
      setZoneIdInput("")
      setSelectedZoneId(null)
      setSelectedVertexIndex(null)
      setRenumberInput("")
      setEditMode("move")
      setUnsavedChanges(false)
      setLoading(false)
    }

    checkAndLoad()
  }, [navigate, partId, sectionIndex, returnTarget])

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!unsavedChanges) return
      e.preventDefault()
      e.returnValue = ""
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [unsavedChanges])

  const usedZoneIds = useMemo(() => new Set(zones.map((z) => z.zone_id)), [zones])
  const currentSectionNumber = parseInt(sectionIndex, 10)

  function confirmLoseChanges() {
    if (!unsavedChanges) return true
    return window.confirm("You have unsaved changes. Leave without saving?")
  }

  function goBack() {
    if (!confirmLoseChanges()) return

    if (returnTarget === "part") {
      navigate(`/part/${partId}`)
      return
    }
    navigate("/")
  }

  function goToSection(targetSection) {
    if (targetSection === currentSectionNumber) return
    if (!confirmLoseChanges()) return

    navigate(`/admin/editor/${partId}/${targetSection}?return=${returnTarget}`)
  }

  function svgPointFromEvent(svg, e) {
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [Math.round(local.x), Math.round(local.y)]
  }

  function clearSelection() {
    setSelectedZoneId(null)
    setSelectedVertexIndex(null)
    setRenumberInput("")
    setEditMode("move")
  }

  function onSvgClick(e) {
    if (dragInfo) return

    if (suppressNextSvgClick) {
      setSuppressNextSvgClick(false)
      return
    }

    const svg = e.currentTarget
    const [x, y] = svgPointFromEvent(svg, e)

    if (editMode === "insert" && selectedZoneId) {
      const zone = zones.find((z) => z.zone_id === selectedZoneId)
      if (!zone || zone.points.length < 2) return

      const insertIndex = findBestEdgeInsertIndex(zone.points, [x, y], 18)
      if (insertIndex === null) {
        return
      }

      setZones((prev) =>
        prev.map((z) => {
          if (z.zone_id !== selectedZoneId) return z
          const nextPoints = [...z.points]
          nextPoints.splice(insertIndex, 0, [x, y])
          return { ...z, points: nextPoints }
        })
      )
      setSelectedVertexIndex(insertIndex)
      setUnsavedChanges(true)
      return
    }

    if (selectedZoneId) {
      clearSelection()
      return
    }

    setDraftPoints((prev) => [...prev, [x, y]])
    setUnsavedChanges(true)
  }

  function onVertexPointerDown(e, zoneId, pointIndex) {
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    setSelectedZoneId(zoneId)
    setSelectedVertexIndex(pointIndex)
    setRenumberInput(String(zoneId))

    if (editMode === "move") {
      setDragInfo({ zoneId, pointIndex, svg })
    }
  }

  function onSvgPointerMove(e) {
    if (!dragInfo) return

    const [x, y] = svgPointFromEvent(dragInfo.svg, e)

    setZones((prev) =>
      prev.map((z) => {
        if (z.zone_id !== dragInfo.zoneId) return z
        return {
          ...z,
          points: z.points.map((p, idx) => (idx === dragInfo.pointIndex ? [x, y] : p)),
        }
      })
    )

    setUnsavedChanges(true)
  }

  function onSvgPointerUp() {
    if (dragInfo) {
      setDragInfo(null)
      setSuppressNextSvgClick(true)
    }
  }

  function clearDraft() {
    if (draftPoints.length === 0) return
    setDraftPoints([])
    setUnsavedChanges(true)
  }

  function undoDraftPoint() {
    if (draftPoints.length === 0) return
    setDraftPoints((prev) => prev.slice(0, -1))
    setUnsavedChanges(true)
  }

  function saveDraftPolygon() {
    const zoneId = parseInt(zoneIdInput, 10)

    if (!zoneId || zoneId < 1 || zoneId > 40) {
      alert("Zone ID must be between 1 and 40")
      return
    }

    if (usedZoneIds.has(zoneId)) {
      alert("That zone ID is already used in this section")
      return
    }

    if (draftPoints.length < 3) {
      alert("Polygon needs at least 3 points")
      return
    }

    setZones((prev) => [
      ...prev,
      {
        zone_id: zoneId,
        points: draftPoints,
      },
    ])

    setSelectedZoneId(zoneId)
    setSelectedVertexIndex(null)
    setRenumberInput(String(zoneId))
    setDraftPoints([])
    setZoneIdInput("")
    setUnsavedChanges(true)
  }

  function selectZone(zoneId) {
    if (selectedZoneId === zoneId) {
      clearSelection()
      return
    }

    setSelectedZoneId(zoneId)
    setSelectedVertexIndex(null)
    setRenumberInput(String(zoneId))
  }

  function deleteZone(zoneId) {
    setZones((prev) => prev.filter((z) => z.zone_id !== zoneId))
    if (selectedZoneId === zoneId) {
      clearSelection()
    }
    setUnsavedChanges(true)
  }

  function deleteSelectedVertex() {
    if (!selectedZoneId || selectedVertexIndex === null) {
      alert("Select a vertex first")
      return
    }

    setZones((prev) =>
      prev.map((z) => {
        if (z.zone_id !== selectedZoneId) return z
        if (z.points.length <= 3) {
          alert("A polygon must have at least 3 vertices")
          return z
        }
        return {
          ...z,
          points: z.points.filter((_, idx) => idx !== selectedVertexIndex),
        }
      })
    )

    setSelectedVertexIndex(null)
    setUnsavedChanges(true)
  }

  function renumberSelectedZone() {
    if (!selectedZoneId) {
      alert("Select a zone first")
      return
    }

    const newId = parseInt(renumberInput, 10)

    if (!newId || newId < 1 || newId > 40) {
      alert("Zone ID must be between 1 and 40")
      return
    }

    if (newId !== selectedZoneId && usedZoneIds.has(newId)) {
      alert("That zone ID is already used in this section")
      return
    }

    setZones((prev) =>
      prev.map((z) =>
        z.zone_id === selectedZoneId ? { ...z, zone_id: newId } : z
      )
    )
    setSelectedZoneId(newId)
    setRenumberInput(String(newId))
    setUnsavedChanges(true)
  }

  async function saveSection() {
    try {
      setBusy(true)

      const res = await fetch(`/api/editor/parts/${partId}/sections/${sectionIndex}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: `section${sectionIndex}_clean.png`,
          image_size: imageSize,
          zones: zones.slice().sort((a, b) => a.zone_id - b.zone_id),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.detail || "Save failed")
        return false
      }

      setUnsavedChanges(false)
      alert("Section saved")
      return true
    } finally {
      setBusy(false)
    }
  }

  const selectedZone = zones.find((z) => z.zone_id === selectedZoneId) || null

  if (!admin || loading) {
    return <div style={{ padding: 20 }}>Loading editor...</div>
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial" }}>
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={goBack}
          style={{
            background: "none",
            border: "none",
            color: "#2563eb",
            cursor: "pointer",
            padding: 0,
            fontSize: "16px",
          }}
        >
          ← Back
        </button>
      </div>

      <h1 style={{ marginTop: 0 }}>
        Editor, {partId.replaceAll("_", " ")}, Section {sectionIndex}
      </h1>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginRight: 6 }}>Sections:</div>
        {availableSections
          .slice()
          .sort((a, b) => a - b)
          .map((sec) => (
            <button
              key={sec}
              onClick={() => goToSection(sec)}
              style={{
                fontWeight: sec === currentSectionNumber ? 700 : 400,
                border: sec === currentSectionNumber ? "2px solid #2563eb" : "1px solid #ccc",
                padding: "6px 10px",
              }}
            >
              Section {sec}
            </button>
          ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <input
          type="number"
          min="1"
          max="40"
          placeholder="New zone ID"
          value={zoneIdInput}
          onChange={(e) => setZoneIdInput(e.target.value)}
          style={{ padding: 8, width: 120 }}
          disabled={selectedZoneId !== null}
        />
        <button onClick={saveDraftPolygon} disabled={selectedZoneId !== null}>
          Close Draft as Polygon
        </button>
        <button onClick={undoDraftPoint} disabled={draftPoints.length === 0 || selectedZoneId !== null}>
          Undo Last Point
        </button>
        <button onClick={clearDraft} disabled={draftPoints.length === 0 || selectedZoneId !== null}>
          Clear Draft
        </button>
        <button onClick={saveSection} disabled={busy}>
          {busy ? "Saving..." : "Save Section"}
        </button>
        <div>Draft points: {draftPoints.length}</div>
        {unsavedChanges && (
          <div style={{ color: "#b45309", fontWeight: 600 }}>Unsaved changes</div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 600 }}>Edit mode:</div>
        <button
          disabled={!selectedZoneId}
          onClick={() => setEditMode("move")}
          style={{
            opacity: selectedZoneId ? 1 : 0.4,
            border: editMode === "move" ? "2px solid #2563eb" : "1px solid #ccc",
            padding: "6px 10px",
            fontWeight: editMode === "move" ? 700 : 400,
          }}
        >
          Move
        </button>
        <button
          disabled={!selectedZoneId}
          onClick={() => setEditMode("insert")}
          style={{
            opacity: selectedZoneId ? 1 : 0.4,
            border: editMode === "insert" ? "2px solid #2563eb" : "1px solid #ccc",
            padding: "6px 10px",
            fontWeight: editMode === "insert" ? 700 : 400,
          }}
        >
          Insert Vertex
        </button>
        <button onClick={deleteSelectedVertex} disabled={selectedVertexIndex === null}>
          Delete Selected Vertex
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        <div style={{ position: "relative", border: "1px solid #ccc" }}>
          <img src={imageUrl} style={{ width: "100%", display: "block" }} />

          <svg
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              cursor: dragInfo
                ? "grabbing"
                : selectedZoneId && editMode === "insert"
                ? "copy"
                : selectedZoneId
                ? "default"
                : "crosshair",
            }}
            onClick={onSvgClick}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerLeave={onSvgPointerUp}
          >
            {zones.map((z) => {
              const selected = z.zone_id === selectedZoneId
              const c = centroid(z.points)

              return (
                <g key={z.zone_id}>
                  <polygon
                    points={z.points.map((p) => p.join(",")).join(" ")}
                    fill={selected ? "rgba(0,140,255,0.28)" : "rgba(0,140,255,0.18)"}
                    stroke={selected ? "rgba(0,80,200,1)" : "rgba(0,100,220,0.95)"}
                    strokeWidth={selected ? "3" : "2"}
                    onClick={(e) => {
                      e.stopPropagation()
                      selectZone(z.zone_id)
                    }}
                    style={{ cursor: "pointer" }}
                  />

                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="24"
                    fill="rgba(0,70,140,0.95)"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {z.zone_id}
                  </text>

                  {selected &&
                    z.points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p[0]}
                        cy={p[1]}
                        r={selectedVertexIndex === i ? "10" : "8"}
                        fill={selectedVertexIndex === i ? "#dbeafe" : "white"}
                        stroke="rgba(0,80,200,1)"
                        strokeWidth="3"
                        onPointerDown={(e) => onVertexPointerDown(e, z.zone_id, i)}
                        style={{ cursor: editMode === "move" ? "grab" : "pointer" }}
                      />
                    ))}
                </g>
              )
            })}

            {draftPoints.length > 0 && (
              <>
                <polyline
                  points={draftPoints.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="orange"
                  strokeWidth="3"
                />
                {draftPoints.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r="6" fill="orange" />
                ))}
              </>
            )}
          </svg>
        </div>

        <div style={{ border: "1px solid #ccc", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Zones</h3>

          {zones.length === 0 && <div>No zones yet</div>}

          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {zones
              .slice()
              .sort((a, b) => a.zone_id - b.zone_id)
              .map((z) => {
                const selected = z.zone_id === selectedZoneId

                return (
                  <div
                    key={z.zone_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: selected ? "2px solid #2563eb" : "1px solid #ddd",
                      padding: 8,
                    }}
                  >
                    <button
                      onClick={() => selectZone(z.zone_id)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        fontWeight: selected ? 700 : 400,
                      }}
                    >
                      Zone {z.zone_id}
                    </button>
                    <button onClick={() => deleteZone(z.zone_id)}>Delete</button>
                  </div>
                )
              })}
          </div>

          <div style={{ borderTop: "1px solid #ddd", paddingTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>Selected Zone</h4>

            {!selectedZone && <div>No zone selected</div>}

            {selectedZone && (
              <>
                <div style={{ marginBottom: 8 }}>Zone {selectedZone.zone_id}</div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="number"
                    min="1"
                    max="40"
                    value={renumberInput}
                    onChange={(e) => setRenumberInput(e.target.value)}
                    style={{ padding: 8, width: 120 }}
                  />
                  <button onClick={renumberSelectedZone}>Renumber</button>
                  <button onClick={() => deleteZone(selectedZone.zone_id)}>
                    Delete Selected
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 14, color: "#555" }}>
                  {editMode === "move"
                    ? "Drag a white handle to move a vertex."
                    : "Click near one of the selected zone's edges to insert a vertex."}
                </div>

                {selectedVertexIndex !== null && (
                  <div style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
                    Selected vertex: {selectedVertexIndex + 1}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function centroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 }

  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }),
    { x: 0, y: 0 }
  )

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  }
}

function findBestEdgeInsertIndex(points, clickPoint, maxDistance = 18) {
  if (!points || points.length < 2) return null

  let bestIndex = null
  let bestDistance = Infinity

  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const distance = pointToSegmentDistance(clickPoint, a, b)

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i + 1
    }
  }

  if (bestDistance > maxDistance) return null
  return bestIndex
}

function pointToSegmentDistance(p, a, b) {
  const px = p[0]
  const py = p[1]
  const ax = a[0]
  const ay = a[1]
  const bx = b[0]
  const by = b[1]

  const dx = bx - ax
  const dy = by - ay

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay)
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t))

  const closestX = ax + t * dx
  const closestY = ay + t * dy

  return Math.hypot(px - closestX, py - closestY)
}