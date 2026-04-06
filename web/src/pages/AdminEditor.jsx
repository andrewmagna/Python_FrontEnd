import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

const ORIENTATION_OPTIONS = [
  { value: 1, label: "0°" },
  { value: 2, label: "90°" },
  { value: 3, label: "180°" },
  { value: 4, label: "270°" },
];

const ORIENTATION_SELECT_OPTIONS = [
  { value: "", label: "Unassigned" },
  ...ORIENTATION_OPTIONS.map((option) => ({
    value: String(option.value),
    label: option.label,
  })),
];

export default function AdminEditor() {
  const { partId, sectionIndex } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const returnTarget = searchParams.get("return") || "grid";

  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 1920, height: 1080 });
  const [zones, setZones] = useState([]);
  const [draftPoints, setDraftPoints] = useState([]);
  const [zoneIdInput, setZoneIdInput] = useState("");
  const [zoneIdTouched, setZoneIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [availableSections, setAvailableSections] = useState([]);
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState(null);
  const [renumberInput, setRenumberInput] = useState("");
  const [dragInfo, setDragInfo] = useState(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [suppressNextSvgClick, setSuppressNextSvgClick] = useState(false);
  const [editMode, setEditMode] = useState("move");
  const [partUsedZoneIdsOtherSections, setPartUsedZoneIdsOtherSections] =
    useState([]);
  const [zoneIdsByOtherSection, setZoneIdsByOtherSection] = useState({});
  const [zoom, setZoom] = useState(1);
  const [panInfo, setPanInfo] = useState(null);
  const [workspaceHeight, setWorkspaceHeight] = useState(520);
  const [hoveredZoneId, setHoveredZoneId] = useState(null);
  const [activeControlTab, setActiveControlTab] = useState("draw");

  const [showOrientationPanel, setShowOrientationPanel] = useState(false);
  const [orientationEditMode, setOrientationEditMode] = useState("assign");
  const [orientationValue, setOrientationValue] = useState(1);
  const [orientationLassoPoints, setOrientationLassoPoints] = useState([]);
  const [orientationIsDrawing, setOrientationIsDrawing] = useState(false);
  const [orientationCandidateZoneIds, setOrientationCandidateZoneIds] =
    useState([]);
  const [orientationReviewMode, setOrientationReviewMode] = useState(false);

  const pageRef = useRef(null);
  const workspaceRef = useRef(null);
  const svgRef = useRef(null);
  const viewerRef = useRef(null);
  const zonesListRef = useRef(null);
  const selectedZoneRowRef = useRef(null);
  const hasUserAdjustedZoomRef = useRef(false);

  function normalizeZone(zone) {
    return {
      zone_id: zone.zone_id,
      points: zone.points || [],
      orientation:
        zone.orientation === 1 ||
        zone.orientation === 2 ||
        zone.orientation === 3 ||
        zone.orientation === 4
          ? zone.orientation
          : null,
    };
  }

  function getOrientationLabel(value) {
    return (
      ORIENTATION_OPTIONS.find((o) => o.value === value)?.label || "Unassigned"
    );
  }

  function getZoneEditorColors(orientation, selected, candidate) {
    if (candidate) {
      return {
        fill: selected ? "rgba(180, 95, 22, 0.30)" : "rgba(180, 95, 22, 0.22)",
        stroke: selected ? "rgba(140, 73, 16, 1)" : "rgba(156, 82, 18, 0.95)",
        label: "rgba(110, 58, 14, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    if (orientation == null) {
      return {
        fill: selected ? "rgba(0, 140, 255, 0.28)" : "rgba(0, 140, 255, 0.18)",
        stroke: selected ? "rgba(0, 80, 200, 1)" : "rgba(0, 100, 220, 0.95)",
        label: "rgba(0, 70, 140, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    if (orientation === 1) {
      return {
        fill: selected ? "rgba(47, 172, 40, 0.28)" : "rgba(47, 172, 40, 0.18)",
        stroke: selected ? "rgba(44, 92, 85, 1)" : "rgba(52, 106, 99, 0.95)",
        label: "rgba(38, 77, 72, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    if (orientation === 2) {
      return {
        fill: selected
          ? "rgba(198, 132, 27, 0.28)"
          : "rgba(198, 132, 27, 0.18)",
        stroke: selected ? "rgba(118, 94, 56, 1)" : "rgba(132, 106, 64, 0.95)",
        label: "rgba(95, 75, 44, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    if (orientation === 3) {
      return {
        fill: selected ? "rgba(211, 15, 64, 0.28)" : "rgba(211, 15, 64, 0.18)",
        stroke: selected ? "rgba(98, 72, 83, 1)" : "rgba(114, 84, 96, 0.95)",
        label: "rgba(80, 59, 68, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    if (orientation === 4) {
      return {
        fill: selected
          ? "rgba(158, 25, 195, 0.28)"
          : "rgba(158, 25, 195, 0.18)",
        stroke: selected ? "rgba(79, 78, 108, 1)" : "rgba(92, 91, 124, 0.95)",
        label: "rgba(67, 66, 92, 0.98)",
        labelBg: "rgba(255,255,255,0.44)",
      };
    }

    return {
      fill: selected ? "rgba(0, 140, 255, 0.28)" : "rgba(0, 140, 255, 0.18)",
      stroke: selected ? "rgba(0, 80, 200, 1)" : "rgba(0, 100, 220, 0.95)",
      label: "rgba(0, 70, 140, 0.98)",
      labelBg: "rgba(255,255,255,0.44)",
    };
  }

  function resetOrientationAssignmentState() {
    setActiveControlTab("draw");
    setShowOrientationPanel(false);
    setOrientationEditMode("assign");
    setOrientationValue(1);
    setOrientationLassoPoints([]);
    setOrientationIsDrawing(false);
    setOrientationCandidateZoneIds([]);
    setOrientationReviewMode(false);
  }

  function clearOrientationSelectionOnly() {
    setOrientationLassoPoints([]);
    setOrientationIsDrawing(false);
    setOrientationCandidateZoneIds([]);
    setOrientationReviewMode(false);
  }

  async function loadEditorSection({ preserveView = false } = {}) {
    const savedZoom = zoom;
    const savedScrollLeft = viewerRef.current?.scrollLeft || 0;
    const savedScrollTop = viewerRef.current?.scrollTop || 0;

    if (!preserveView) {
      hasUserAdjustedZoomRef.current = false;
    }

    setLoading(true);

    const statusRes = await fetch("/api/admin/status");
    const statusData = await statusRes.json();

    if (!statusData.admin) {
      const next = encodeURIComponent(
        `/admin/editor/${partId}/${sectionIndex}?return=${returnTarget}`,
      );
      navigate(`/admin/login?next=${next}`);
      return;
    }

    setAdmin(true);

    const partRes = await fetch(`/api/parts/${partId}`);
    if (partRes.ok) {
      const partData = await partRes.json();
      setAvailableSections((partData.sections || []).map((s) => s.index));
    }

    const res = await fetch(
      `/api/editor/parts/${partId}/sections/${sectionIndex}`,
    );
    if (!res.ok) {
      alert("Failed to load editor section");
      setLoading(false);
      return;
    }

    const data = await res.json();
    setImageUrl(data.image_url);
    setImageSize(data.image_size || { width: 1920, height: 1080 });
    setZones((data.zones || []).map(normalizeZone));
    setPartUsedZoneIdsOtherSections(
      data.part_used_zone_ids_other_sections || [],
    );
    setZoneIdsByOtherSection(data.zone_ids_by_other_section || {});
    setDraftPoints([]);
    setZoneIdInput("");
    setZoneIdTouched(false);
    setSelectedZoneId(null);
    setSelectedVertexIndex(null);
    setRenumberInput("");
    setEditMode("move");
    setUnsavedChanges(false);
    setPanInfo(null);
    setHoveredZoneId(null);
    resetOrientationAssignmentState();
    setLoading(false);

    if (zonesListRef.current) {
      zonesListRef.current.scrollTop = 0;
    }

    if (preserveView) {
      requestAnimationFrame(() => {
        setZoom(savedZoom);
        requestAnimationFrame(() => {
          if (viewerRef.current) {
            viewerRef.current.scrollLeft = savedScrollLeft;
            viewerRef.current.scrollTop = savedScrollTop;
          }
        });
      });
    }
  }

  useEffect(() => {
    loadEditorSection();
  }, [navigate, partId, sectionIndex, returnTarget]);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!unsavedChanges) return;
      e.preventDefault();
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [unsavedChanges]);

  const usedZoneIds = useMemo(
    () => new Set(zones.map((z) => z.zone_id)),
    [zones],
  );
  const forbiddenZoneIds = useMemo(
    () => new Set(partUsedZoneIdsOtherSections),
    [partUsedZoneIdsOtherSections],
  );
  const currentSectionNumber = parseInt(sectionIndex, 10);
  const showSectionSelector = availableSections.length > 1;

  const nextAvailableZoneId = useMemo(() => {
    for (let i = 1; i <= 40; i++) {
      if (!usedZoneIds.has(i) && !forbiddenZoneIds.has(i)) {
        return String(i);
      }
    }
    return "";
  }, [usedZoneIds, forbiddenZoneIds]);

  const scaleFactor = imageSize.width / 1920;
  const handleRadius = Math.max(8, 8 * scaleFactor);
  const selectedHandleRadius = Math.max(10, 10 * scaleFactor);
  const handleStrokeWidth = Math.max(3, 3 * scaleFactor);
  const zoneStrokeWidth = Math.max(2, 2 * scaleFactor);
  const selectedZoneStrokeWidth = Math.max(3, 3 * scaleFactor);
  const zoneLabelFontSize = Math.max(24, 24 * scaleFactor);
  const draftHandleRadius = Math.max(6, 6 * scaleFactor);
  const draftStrokeWidth = Math.max(3, 3 * scaleFactor);
  const orientationLassoStrokeWidth = Math.max(2, 2 * scaleFactor);
  const labelPaddingX = Math.max(10, 10 * scaleFactor);
  const labelPaddingY = Math.max(5, 5 * scaleFactor);
  const labelRadius = Math.max(8, 8 * scaleFactor);

  const orientationCandidateSet = useMemo(
    () => new Set(orientationCandidateZoneIds),
    [orientationCandidateZoneIds],
  );

  useEffect(() => {
    if (selectedZoneId !== null || showOrientationPanel) {
      return;
    }

    if (
      !zoneIdTouched ||
      zoneIdInput === "" ||
      usedZoneIds.has(Number(zoneIdInput)) ||
      forbiddenZoneIds.has(Number(zoneIdInput))
    ) {
      setZoneIdInput(nextAvailableZoneId);
    }
  }, [
    nextAvailableZoneId,
    selectedZoneId,
    showOrientationPanel,
    zoneIdTouched,
    zoneIdInput,
    usedZoneIds,
    forbiddenZoneIds,
  ]);

  useEffect(() => {
    if (!selectedZoneId || !selectedZoneRowRef.current) return;

    selectedZoneRowRef.current.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedZoneId]);

  function clampInitialZoom(value) {
    return Math.max(0.2, Math.min(3, Number(value.toFixed(2))));
  }

  function clampUserZoom(value) {
    return Math.max(0.2, Math.min(8, Number(value.toFixed(2))));
  }

  function measureWorkspaceHeight() {
    if (!workspaceRef.current) return;

    const rect = workspaceRef.current.getBoundingClientRect();
    const nextHeight = Math.max(
      320,
      Math.floor(window.innerHeight - rect.top - 10),
    );
    setWorkspaceHeight(nextHeight);
  }

  function getFitZoom() {
    const viewer = viewerRef.current;
    if (!viewer || !imageSize.width || !imageSize.height) {
      return 1;
    }

    const viewerWidth = viewer.clientWidth - 24;
    const viewerHeight = viewer.clientHeight - 24;

    if (viewerWidth <= 0 || viewerHeight <= 0) {
      return 1;
    }

    const fitWidth = viewerWidth / imageSize.width;
    const fitHeight = viewerHeight / imageSize.height;
    const fitZoom = Math.min(fitWidth, fitHeight);

    const fittedRenderWidth = imageSize.width * fitZoom;
    const fittedRenderHeight = imageSize.height * fitZoom;

    const minPreferredWidth = 900;
    const maxPreferredWidth = 1150;
    const minPreferredHeight = 500;
    const maxPreferredHeight = 720;

    let zoom = fitZoom;

    if (fittedRenderWidth < minPreferredWidth) {
      zoom = Math.max(zoom, minPreferredWidth / imageSize.width);
    }

    if (fittedRenderWidth > maxPreferredWidth) {
      zoom = Math.min(zoom, maxPreferredWidth / imageSize.width);
    }

    if (fittedRenderHeight < minPreferredHeight) {
      zoom = Math.max(zoom, minPreferredHeight / imageSize.height);
    }

    if (fittedRenderHeight > maxPreferredHeight) {
      zoom = Math.min(zoom, maxPreferredHeight / imageSize.height);
    }

    zoom = Math.min(zoom, fitZoom);

    return clampInitialZoom(zoom);
  }

  useEffect(() => {
    measureWorkspaceHeight();

    const handleResize = () => {
      measureWorkspaceHeight();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

    useEffect(() => {
      if (loading) return;
      if (!viewerRef.current) return;
      if (!imageSize.width || !imageSize.height) return;

      const applyFitZoom = ({ force = false } = {}) => {
        measureWorkspaceHeight();

        requestAnimationFrame(() => {
          if (!force && hasUserAdjustedZoomRef.current) {
            return;
          }

          const fitZoom = getFitZoom();
          setZoom(fitZoom);
    
          requestAnimationFrame(() => {
            if (viewerRef.current) {
              viewerRef.current.scrollLeft = 0;
              viewerRef.current.scrollTop = 0;
            }
          });
        });
      };

      const raf = requestAnimationFrame(() => applyFitZoom({ force: true }));

      const handleResize = () => {
        applyFitZoom({ force: false });
      };

      window.addEventListener("resize", handleResize);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", handleResize);
      };
    }, [loading, imageSize.width, imageSize.height, imageUrl]);

  function confirmLoseChanges() {
    if (!unsavedChanges) return true;
    return window.confirm("You have unsaved changes. Leave without saving?");
  }

  function goBack() {
    if (!confirmLoseChanges()) return;

    if (returnTarget === "part") {
      navigate(`/part/${partId}`);
      return;
    }
    navigate("/");
  }

  function goToSection(targetSection) {
    if (targetSection === currentSectionNumber) return;
    if (!confirmLoseChanges()) return;

    navigate(`/admin/editor/${partId}/${targetSection}?return=${returnTarget}`);
  }

  function zoomIn() {
    hasUserAdjustedZoomRef.current = true;
    setZoom((prev) => clampUserZoom(prev + 0.1));
  }

  function zoomOut() {
    hasUserAdjustedZoomRef.current = true;
    setZoom((prev) => clampUserZoom(prev - 0.1));
  }

  function resetZoom() {
    hasUserAdjustedZoomRef.current = false;
    const fitZoom = getFitZoom();
    setZoom(fitZoom);
    setPanInfo(null);
    

    requestAnimationFrame(() => {
      if (viewerRef.current) {
        viewerRef.current.scrollLeft = 0;
        viewerRef.current.scrollTop = 0;
      }
    });
  }

  function onViewerWheel(e) {
    e.preventDefault();
  }

  function svgPointFromEvent(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.round(local.x), Math.round(local.y)];
  }

  function clearSelection() {
    setSelectedZoneId(null);
    setSelectedVertexIndex(null);
    setRenumberInput("");
    setEditMode("move");
  }

  function startPan(e) {
    if (zoom <= 1) return;
    if (!viewerRef.current) return;
    if (showOrientationPanel) return;

    setPanInfo({
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewerRef.current.scrollLeft,
      scrollTop: viewerRef.current.scrollTop,
      moved: false,
    });
  }

  function onViewerPointerDown(e) {
    if (dragInfo) return;
    if (showOrientationPanel) return;
    if (e.button !== 0) return;
    startPan(e);
  }

  function onViewerPointerMove(e) {
    if (showOrientationPanel) return;
    if (!panInfo || !viewerRef.current) return;

    const dx = e.clientX - panInfo.startX;
    const dy = e.clientY - panInfo.startY;

    viewerRef.current.scrollLeft = panInfo.scrollLeft - dx;
    viewerRef.current.scrollTop = panInfo.scrollTop - dy;

    if (!panInfo.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      setPanInfo((prev) =>
        prev
          ? {
              ...prev,
              moved: true,
            }
          : prev,
      );
    }
  }

  function onViewerPointerUp() {
    if (showOrientationPanel) return;

    if (panInfo) {
      if (panInfo.moved) {
        setSuppressNextSvgClick(true);
      }
      setPanInfo(null);
    }
  }

  function onSvgPointerDown(e) {
    if (!showOrientationPanel) return;
    if (orientationReviewMode) return;
    if (dragInfo) return;
    if (!svgRef.current) return;
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const [x, y] = svgPointFromEvent(svgRef.current, e);

    setPanInfo(null);
    setSuppressNextSvgClick(false);
    setOrientationCandidateZoneIds([]);
    setOrientationReviewMode(false);
    setOrientationIsDrawing(true);
    setOrientationLassoPoints([[x, y]]);

    if (e.currentTarget.setPointerCapture) {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function onSvgClick(e) {
    if (dragInfo) return;

    if (suppressNextSvgClick) {
      setSuppressNextSvgClick(false);
      return;
    }

    if (showOrientationPanel) {
      return;
    }

    const svg = e.currentTarget;
    const [x, y] = svgPointFromEvent(svg, e);

    if (editMode === "insert" && selectedZoneId) {
      const zone = zones.find((z) => z.zone_id === selectedZoneId);
      if (!zone || zone.points.length < 2) return;

      const insertIndex = findBestEdgeInsertIndex(zone.points, [x, y], 18);
      if (insertIndex === null) {
        return;
      }

      setZones((prev) =>
        prev.map((z) => {
          if (z.zone_id !== selectedZoneId) return z;
          const nextPoints = [...z.points];
          nextPoints.splice(insertIndex, 0, [x, y]);
          return { ...z, points: nextPoints };
        }),
      );
      setSelectedVertexIndex(insertIndex);
      setUnsavedChanges(true);
      return;
    }

    if (selectedZoneId) {
      clearSelection();
      return;
    }

    setDraftPoints((prev) => [...prev, [x, y]]);
    setUnsavedChanges(true);
  }

  function onVertexPointerDown(e, zoneId, pointIndex) {
    if (showOrientationPanel) return;

    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    setSelectedZoneId(zoneId);
    setSelectedVertexIndex(pointIndex);
    setRenumberInput(String(zoneId));

    if (editMode === "move") {
      setDragInfo({ type: "vertex", zoneId, pointIndex, svg });
    }
  }

  function onZonePointerDown(e, zoneId) {
    if (showOrientationPanel) return;

    e.stopPropagation();

    if (selectedZoneId !== zoneId) return;
    if (editMode !== "move") return;
    if (!svgRef.current) return;

    const [x, y] = svgPointFromEvent(svgRef.current, e);
    setDragInfo({
      type: "zone",
      zoneId,
      svg: svgRef.current,
      startPoint: [x, y],
    });
  }

  function selectZone(zoneId) {
    setSelectedZoneId(zoneId);
    setSelectedVertexIndex(null);
    setRenumberInput(String(zoneId));
  }

  function onZoneClick(e, zoneId) {
    e.stopPropagation();

    if (showOrientationPanel && orientationReviewMode) {
      setOrientationCandidateZoneIds((prev) =>
        prev.includes(zoneId)
          ? prev.filter((id) => id !== zoneId)
          : [...prev, zoneId],
      );
      return;
    }

    if (showOrientationPanel) {
      return;
    }

    if (selectedZoneId === zoneId) {
      clearSelection();
      return;
    }

    selectZone(zoneId);
  }

  function onSvgPointerMove(e) {
    if (showOrientationPanel && orientationIsDrawing && svgRef.current) {
      const [x, y] = svgPointFromEvent(svgRef.current, e);

      setOrientationLassoPoints((prev) => {
        if (prev.length === 0) return [[x, y]];

        const last = prev[prev.length - 1];
        const dx = x - last[0];
        const dy = y - last[1];

        if (dx * dx + dy * dy < 16) {
          return prev;
        }

        return [...prev, [x, y]];
      });
      return;
    }

    if (!dragInfo) return;

    if (dragInfo.type === "vertex") {
      const [x, y] = svgPointFromEvent(dragInfo.svg, e);

      setZones((prev) =>
        prev.map((z) => {
          if (z.zone_id !== dragInfo.zoneId) return z;
          return {
            ...z,
            points: z.points.map((p, idx) =>
              idx === dragInfo.pointIndex ? [x, y] : p,
            ),
          };
        }),
      );

      setUnsavedChanges(true);
      return;
    }

    if (dragInfo.type === "zone") {
      const [x, y] = svgPointFromEvent(dragInfo.svg, e);
      const dx = x - dragInfo.startPoint[0];
      const dy = y - dragInfo.startPoint[1];

      setZones((prev) =>
        prev.map((z) => {
          if (z.zone_id !== dragInfo.zoneId) return z;
          return {
            ...z,
            points: z.points.map((p) => [p[0] + dx, p[1] + dy]),
          };
        }),
      );

      setDragInfo((prev) =>
        prev
          ? {
              ...prev,
              startPoint: [x, y],
            }
          : prev,
      );

      setUnsavedChanges(true);
    }
  }

  function onSvgPointerUp(e) {
    if (showOrientationPanel && orientationIsDrawing) {
      e.preventDefault();
      e.stopPropagation();

      const candidateIds = zones
        .filter((z) => isCentroidInPolygon(z.points, orientationLassoPoints))
        .map((z) => z.zone_id);

      setOrientationCandidateZoneIds(candidateIds);
      setOrientationReviewMode(true);
      setOrientationIsDrawing(false);

      if (e.currentTarget.releasePointerCapture) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {}
      }

      return;
    }

    if (dragInfo) {
      setDragInfo(null);
      setSuppressNextSvgClick(true);
    }
  }

  async function revertChanges() {
    if (!unsavedChanges) return;

    const ok = window.confirm(
      "Revert all unsaved changes and restore the last saved version?",
    );
    if (!ok) return;

    clearSelection();
    await loadEditorSection({ preserveView: true });
  }

  function undoDraftPoint() {
    if (draftPoints.length === 0) return;
    setDraftPoints((prev) => prev.slice(0, -1));
    setUnsavedChanges(true);
  }

  function saveDraftPolygon() {
    const zoneId = parseInt(zoneIdInput, 10);

    if (!zoneId || zoneId < 1 || zoneId > 40) {
      alert("Zone ID must be between 1 and 40");
      return;
    }

    if (forbiddenZoneIds.has(zoneId)) {
      alert(
        `Zone ID ${zoneId} is already used in another section of this part`,
      );
      return;
    }

    if (usedZoneIds.has(zoneId)) {
      alert("That zone ID is already used in this section");
      return;
    }

    if (draftPoints.length < 3) {
      alert("Polygon needs at least 3 points");
      return;
    }

    setZones((prev) => [
      ...prev,
      {
        zone_id: zoneId,
        points: draftPoints,
        orientation: null,
      },
    ]);

    setSelectedZoneId(zoneId);
    setSelectedVertexIndex(null);
    setRenumberInput(String(zoneId));
    setDraftPoints([]);
    setZoneIdInput("");
    setZoneIdTouched(false);
    setUnsavedChanges(true);
  }

  async function importOverlay() {
    if (zones.length > 0) {
      const ok = window.confirm(
        "Importing from overlay will replace all current zones in this section. Continue?",
      );
      if (!ok) return;
    }

    try {
      setImportBusy(true);

      const res = await fetch(
        `/api/editor/parts/${partId}/sections/${sectionIndex}/import`,
        {
          method: "POST",
        },
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(data.detail || "Overlay import failed");
        return;
      }

      const importedZones = Array.isArray(data.zones)
        ? data.zones.map(normalizeZone)
        : [];
      const nextImageSize =
        data.image_size && data.image_size.width && data.image_size.height
          ? data.image_size
          : imageSize;

      setZones(importedZones);
      setImageSize(nextImageSize);
      setDraftPoints([]);
      setZoneIdInput("");
      setZoneIdTouched(false);
      setSelectedVertexIndex(null);
      setRenumberInput("");
      setEditMode("move");
      clearOrientationSelectionOnly();
      setUnsavedChanges(true);

      if (importedZones.length > 0) {
        setSelectedZoneId(importedZones[0].zone_id);
        setRenumberInput(String(importedZones[0].zone_id));
      } else {
        setSelectedZoneId(null);
      }

      if (data.debug) {
        console.log("Overlay import debug", data.debug);
      }

      alert(`Imported ${importedZones.length} zones from overlay`);
    } catch {
      alert("Overlay import failed");
    } finally {
      setImportBusy(false);
    }
  }

  function applyOrientationAssignment() {
    if (!orientationReviewMode) {
      alert("Draw a lasso first");
      return;
    }

    if (orientationCandidateZoneIds.length === 0) {
      alert("No zones selected for orientation update");
      return;
    }

    setZones((prev) =>
      prev.map((z) => {
        if (!orientationCandidateSet.has(z.zone_id)) return z;

        if (orientationEditMode === "assign") {
          return { ...z, orientation: orientationValue };
        }

        if (z.orientation === orientationValue) {
          return { ...z, orientation: null };
        }

        return z;
      }),
    );

    setUnsavedChanges(true);
    clearOrientationSelectionOnly();
  }

  function updateSelectedZoneOrientation(value) {
    if (!selectedZoneId) return;

    const nextOrientation =
      value === ""
        ? null
        : [1, 2, 3, 4].includes(Number(value))
          ? Number(value)
          : null;

    setZones((prev) =>
      prev.map((z) =>
        z.zone_id === selectedZoneId
          ? {
              ...z,
              orientation: nextOrientation,
            }
          : z,
      ),
    );

    setUnsavedChanges(true);
  }

  function deleteZone(zoneId) {
    setZones((prev) => prev.filter((z) => z.zone_id !== zoneId));
    setOrientationCandidateZoneIds((prev) =>
      prev.filter((id) => id !== zoneId),
    );
    if (selectedZoneId === zoneId) {
      clearSelection();
    }
    setUnsavedChanges(true);
  }

  function deleteSelectedVertex() {
    if (!selectedZoneId || selectedVertexIndex === null) {
      alert("Select a vertex first");
      return;
    }

    setZones((prev) =>
      prev.map((z) => {
        if (z.zone_id !== selectedZoneId) return z;
        if (z.points.length <= 3) {
          alert("A polygon must have at least 3 vertices");
          return z;
        }
        return {
          ...z,
          points: z.points.filter((_, idx) => idx !== selectedVertexIndex),
        };
      }),
    );

    setSelectedVertexIndex(null);
    setUnsavedChanges(true);
  }

  function renumberSelectedZone() {
    if (!selectedZoneId) {
      alert("Select a zone first");
      return;
    }

    const newId = parseInt(renumberInput, 10);

    if (!newId || newId < 1 || newId > 40) {
      alert("Zone ID must be between 1 and 40");
      return;
    }

    if (newId !== selectedZoneId && forbiddenZoneIds.has(newId)) {
      alert(`Zone ID ${newId} is already used in another section of this part`);
      return;
    }

    if (newId !== selectedZoneId && usedZoneIds.has(newId)) {
      alert("That zone ID is already used in this section");
      return;
    }

    setZones((prev) =>
      prev.map((z) =>
        z.zone_id === selectedZoneId ? { ...z, zone_id: newId } : z,
      ),
    );

    setOrientationCandidateZoneIds((prev) =>
      prev.map((id) => (id === selectedZoneId ? newId : id)),
    );

    setSelectedZoneId(newId);
    setRenumberInput(String(newId));
    setUnsavedChanges(true);
  }

  async function saveSection() {
    try {
      setBusy(true);

      const res = await fetch(
        `/api/editor/parts/${partId}/sections/${sectionIndex}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image: `section${sectionIndex}_clean.png`,
            image_size: imageSize,
            zones: zones
              .slice()
              .sort((a, b) => a.zone_id - b.zone_id)
              .map((z) => ({
                zone_id: z.zone_id,
                points: z.points,
                orientation: z.orientation ?? null,
              })),
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Save failed");
        return false;
      }

      setUnsavedChanges(false);
      alert("Section saved");
      return true;
    } finally {
      setBusy(false);
    }
  }

  const selectedZone = zones.find((z) => z.zone_id === selectedZoneId) || null;

  if (!admin || loading) {
    return <div style={{ padding: 20 }}>Loading editor...</div>;
  }

  return (
    <div
      ref={pageRef}
      style={{
        padding: "8px 10px 10px",
        fontFamily: "Arial, sans-serif",
        color: "#1f2937",
        width: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={goBack}
          style={{
            background: "none",
            border: "none",
            color: "#2563eb",
            cursor: "pointer",
            padding: 0,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          ← Back
        </button>
      </div>

      <h1 style={{ marginTop: 0, marginBottom: 12 }}>
        {partId.replaceAll("_", " ")}
      </h1>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        {showSectionSelector && (
          <>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#6b7280",
              }}
            >
              SECTIONS
            </div>
            {availableSections
              .slice()
              .sort((a, b) => a - b)
              .map((sec) => (
                <button
                  key={sec}
                  onClick={() => goToSection(sec)}
                  style={{
                    fontWeight: sec === currentSectionNumber ? 700 : 400,
                    border:
                      sec === currentSectionNumber
                        ? "2px solid #2563eb"
                        : "1px solid #ccc",
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "#fff",
                  }}
                >
                  Section {sec}
                </button>
              ))}
          </>
        )}

        <div
          style={{
            marginLeft: showSectionSelector ? 8 : 0,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            onClick={saveSection}
            disabled={busy || importBusy}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              background: busy || importBusy ? "#dbeafe" : "#2563eb",
              color: busy || importBusy ? "#6b7280" : "#fff",
              border: "1px solid #2563eb",
              fontWeight: 700,
              boxShadow:
                busy || importBusy ? "none" : "0 4px 12px rgba(37,99,235,0.18)",
            }}
          >
            {busy ? "Saving..." : "Save Section"}
          </button>

          <button
            onClick={revertChanges}
            disabled={!unsavedChanges || busy || importBusy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontWeight: 600,
            }}
          >
            Undo
          </button>

          <button
            onClick={() => {
              if (!confirmLoseChanges()) return;
              navigate(`/admin/recipes/${partId}?return=${returnTarget}`);
            }}
            disabled={busy || importBusy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontWeight: 600,
            }}
          >
            Edit Recipes
          </button>
        </div>

        {unsavedChanges && (
          <div style={{ color: "#b45309", fontWeight: 700 }}>
            Unsaved changes
          </div>
        )}
      </div>

      <div
        ref={workspaceRef}
        style={{
          display: "grid",
          gridTemplateColumns: "340px minmax(0, 1fr) 340px",
          gap: 12,
          alignItems: "stretch",
          height: workspaceHeight,
          minHeight: 0,
        }}
      >
        <div
          style={{
            border: "1px solid #ccc",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            height: "100%",
            minHeight: 0,
            boxSizing: "border-box",
            borderRadius: 10,
            background: "#fff",
          }}
        >
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              flex: "1 1 2",
              overflowY: "auto",
              minHeight: 0,
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 6,
                background: "#f3f4f6",
                padding: 4,
                borderRadius: 10,
              }}
            >
              <button
                onClick={() => setActiveControlTab("draw")}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    activeControlTab === "draw" ? "#fff" : "transparent",
                  fontWeight: activeControlTab === "draw" ? 700 : 500,
                  boxShadow:
                    activeControlTab === "draw"
                      ? "0 1px 3px rgba(0,0,0,0.1)"
                      : "none",
                }}
              >
                Draw
              </button>

              <button
                onClick={() => setActiveControlTab("edit")}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    activeControlTab === "edit" ? "#fff" : "transparent",
                  fontWeight: activeControlTab === "edit" ? 700 : 500,
                  boxShadow:
                    activeControlTab === "edit"
                      ? "0 1px 3px rgba(0,0,0,0.1)"
                      : "none",
                }}
              >
                Edit
              </button>

              <button
                onClick={() => setActiveControlTab("orientation")}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    activeControlTab === "orientation" ? "#fff" : "transparent",
                  fontWeight: activeControlTab === "orientation" ? 700 : 500,
                  boxShadow:
                    activeControlTab === "orientation"
                      ? "0 1px 3px rgba(0,0,0,0.1)"
                      : "none",
                }}
              >
                Orientation
              </button>
            </div>

            {activeControlTab === "draw" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    NEW ZONE ID
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="40"
                    placeholder="New zone ID"
                    value={zoneIdInput}
                    onChange={(e) => {
                      setZoneIdInput(e.target.value);
                      setZoneIdTouched(true);
                    }}
                    style={{
                      padding: 8,
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                    disabled={selectedZoneId !== null || showOrientationPanel}
                  />
                </div>

                <button
                  onClick={saveDraftPolygon}
                  disabled={selectedZoneId !== null || showOrientationPanel}
                >
                  Close Draft
                </button>

                <button
                  onClick={undoDraftPoint}
                  disabled={
                    draftPoints.length === 0 ||
                    selectedZoneId !== null ||
                    showOrientationPanel
                  }
                >
                  Undo Last Point
                </button>

                <button onClick={importOverlay} disabled={importBusy || busy}>
                  {importBusy ? "Importing..." : "Import From Overlay"}
                </button>
              </div>
            )}

            {activeControlTab === "edit" && (
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  disabled={!selectedZoneId || showOrientationPanel}
                  onClick={() => setEditMode("move")}
                  style={{
                    opacity: selectedZoneId && !showOrientationPanel ? 1 : 0.4,
                    border:
                      editMode === "move"
                        ? "2px solid #2563eb"
                        : "1px solid #ccc",
                    padding: "8px 10px",
                    fontWeight: editMode === "move" ? 700 : 400,
                    borderRadius: 8,
                    background: "#fff",
                  }}
                >
                  Move
                </button>

                <button
                  disabled={!selectedZoneId || showOrientationPanel}
                  onClick={() => setEditMode("insert")}
                  style={{
                    opacity: selectedZoneId && !showOrientationPanel ? 1 : 0.4,
                    border:
                      editMode === "insert"
                        ? "2px solid #2563eb"
                        : "1px solid #ccc",
                    padding: "8px 10px",
                    fontWeight: editMode === "insert" ? 700 : 400,
                    borderRadius: 8,
                    background: "#fff",
                  }}
                >
                  Insert Vertex
                </button>

                <button
                  onClick={deleteSelectedVertex}
                  disabled={
                    selectedVertexIndex === null || showOrientationPanel
                  }
                >
                  Delete Selected Vertex
                </button>

                <div
                  style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.4 }}
                >
                  {showOrientationPanel
                    ? "Orientation tool is active."
                    : editMode === "move"
                      ? "Drag a vertex handle, or drag inside the selected zone to move the full zone."
                      : "Click near an edge of the selected zone to insert a new vertex."}
                </div>
              </div>
            )}

            {activeControlTab === "orientation" && (
              <div style={{ display: "grid", gap: 10 }}>
                <button
                  onClick={() => {
                    setShowOrientationPanel((prev) => {
                      const next = !prev;
                      if (!next) {
                        clearOrientationSelectionOnly();
                      }
                      return next;
                    });
                  }}
                  disabled={busy || importBusy || zones.length === 0}
                >
                  {showOrientationPanel
                    ? "Close Orientation Tool"
                    : "Assign Orientations"}
                </button>

                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#6b7280",
                    }}
                  >
                    Orientation
                  </label>
                  <select
                    value={orientationValue}
                    onChange={(e) =>
                      setOrientationValue(Number(e.target.value))
                    }
                    style={{ padding: 8, width: "100%" }}
                    disabled={!showOrientationPanel}
                  >
                    {ORIENTATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#6b7280",
                    }}
                  >
                    Action
                  </label>
                  <select
                    value={orientationEditMode}
                    onChange={(e) => setOrientationEditMode(e.target.value)}
                    style={{ padding: 8, width: "100%" }}
                    disabled={!showOrientationPanel}
                  >
                    <option value="assign">Assign</option>
                    <option value="remove">Remove</option>
                  </select>
                </div>

                <button
                  onClick={clearOrientationSelectionOnly}
                  disabled={!showOrientationPanel}
                >
                  Clear Selection
                </button>

                <button
                  onClick={applyOrientationAssignment}
                  disabled={!showOrientationPanel}
                >
                  Confirm{" "}
                  {orientationEditMode === "assign" ? "Assignment" : "Removal"}
                </button>

                <div
                  style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.4 }}
                >
                  Draw around zones, or click zones on the canvas.
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              flex: "1 1 auto",
              minHeight: 0,
              background: "#fff",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Upcoming Feature</h3>
            <div style={{ fontSize: 14, color: "#666" }}>
              Left bottom panel placeholder
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0, minHeight: 0 }}>
          <div style={{ position: "relative", height: "100%" }}>
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 10,
                display: "flex",
                gap: 6,
                alignItems: "center",
                background: "rgba(255,255,255,0.92)",
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            >
              <button onClick={zoomOut}>-</button>
              <div style={{ minWidth: 52, textAlign: "center", fontSize: 14 }}>
                {Math.round(zoom * 100)}%
              </div>
              <button onClick={zoomIn}>+</button>
              <button onClick={resetZoom}>Reset</button>
            </div>

            <div
              ref={viewerRef}
              onWheelCapture={onViewerWheel}
              onWheel={onViewerWheel}
              onPointerDown={onViewerPointerDown}
              onPointerMove={onViewerPointerMove}
              onPointerUp={onViewerPointerUp}
              onPointerLeave={onViewerPointerUp}
              style={{
                position: "relative",
                border: "1px solid #ccc",
                background: "#f8f8f8",
                overflow: "auto",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
                minHeight: 0,
                cursor: showOrientationPanel
                  ? "default"
                  : panInfo
                    ? "grabbing"
                    : zoom > 1
                      ? "grab"
                      : "default",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: `${zoom * 100}%`,
                  margin: "0 auto",
                  flex: "0 0 auto",
                  flexShrink: 0,
                }}
              >
                <img
                  src={imageUrl}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                  }}
                />

                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    cursor: showOrientationPanel
                      ? orientationIsDrawing
                        ? "crosshair"
                        : orientationReviewMode
                          ? "pointer"
                          : "crosshair"
                      : dragInfo
                        ? "grabbing"
                        : selectedZoneId && editMode === "insert"
                          ? "copy"
                          : selectedZoneId && editMode === "move"
                            ? "move"
                            : selectedZoneId
                              ? "default"
                              : panInfo
                                ? "grabbing"
                                : zoom > 1
                                  ? "grab"
                                  : "crosshair",
                  }}
                  onPointerDown={onSvgPointerDown}
                  onClick={onSvgClick}
                  onPointerMove={onSvgPointerMove}
                  onPointerUp={onSvgPointerUp}
                  onPointerLeave={onSvgPointerUp}
                >
                  {zones.map((z) => {
                    const selected = z.zone_id === selectedZoneId;
                    const candidate = orientationCandidateSet.has(z.zone_id);
                    const hovered = hoveredZoneId === z.zone_id;
                    const c = centroid(z.points);
                    const colors = getZoneEditorColors(
                      z.orientation,
                      selected,
                      candidate,
                    );

                    let strokeWidth = selected
                      ? selectedZoneStrokeWidth
                      : zoneStrokeWidth;

                    if (candidate) {
                      strokeWidth = Math.max(
                        selectedZoneStrokeWidth,
                        zoneStrokeWidth + 1,
                      );
                    } else if (hovered) {
                      strokeWidth = Math.max(
                        selectedZoneStrokeWidth,
                        zoneStrokeWidth + 1,
                      );
                    }

                    const labelText = String(z.zone_id);
                    const estimatedLabelWidth =
                      labelText.length * zoneLabelFontSize * 0.62 +
                      labelPaddingX * 2;
                    const labelHeight =
                      zoneLabelFontSize * 0.95 + labelPaddingY * 2;

                    return (
                      <g
                        key={z.zone_id}
                        onMouseEnter={() => setHoveredZoneId(z.zone_id)}
                        onMouseLeave={() =>
                          setHoveredZoneId((prev) =>
                            prev === z.zone_id ? null : prev,
                          )
                        }
                      >
                        <polygon
                          points={z.points.map((p) => p.join(",")).join(" ")}
                          fill={colors.fill}
                          stroke={colors.stroke}
                          strokeWidth={strokeWidth}
                          onClick={(e) => onZoneClick(e, z.zone_id)}
                          onPointerDown={(e) => onZonePointerDown(e, z.zone_id)}
                          style={{
                            cursor: showOrientationPanel
                              ? "pointer"
                              : selected && editMode === "move"
                                ? "move"
                                : "pointer",
                          }}
                        />

                        <rect
                          x={c.x - estimatedLabelWidth / 2}
                          y={c.y - labelHeight / 2}
                          width={estimatedLabelWidth}
                          height={labelHeight}
                          rx={labelRadius}
                          ry={labelRadius}
                          fill={colors.labelBg}
                          stroke={
                            selected || hovered
                              ? colors.stroke
                              : "rgba(255,255,255,0.0)"
                          }
                          strokeWidth={
                            selected || hovered ? Math.max(1, scaleFactor) : 0
                          }
                          style={{ pointerEvents: "none" }}
                        />

                        <text
                          x={c.x}
                          y={c.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={zoneLabelFontSize}
                          fontWeight={800}
                          fill={colors.label}
                          stroke="rgba(255,255,255,0.92)"
                          strokeWidth={Math.max(2, 2 * scaleFactor)}
                          paintOrder="stroke"
                          letterSpacing="0.01em"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {labelText}
                        </text>

                        {selected &&
                          !showOrientationPanel &&
                          z.points.map((p, i) => (
                            <circle
                              key={i}
                              cx={p[0]}
                              cy={p[1]}
                              r={
                                selectedVertexIndex === i
                                  ? selectedHandleRadius
                                  : handleRadius
                              }
                              fill={
                                selectedVertexIndex === i ? "#dbeafe" : "white"
                              }
                              stroke="rgba(0,80,200,1)"
                              strokeWidth={handleStrokeWidth}
                              onPointerDown={(e) =>
                                onVertexPointerDown(e, z.zone_id, i)
                              }
                              style={{
                                cursor:
                                  editMode === "move" ? "grab" : "pointer",
                              }}
                            />
                          ))}
                      </g>
                    );
                  })}

                  {draftPoints.length > 0 && !showOrientationPanel && (
                    <>
                      <polyline
                        points={draftPoints.map((p) => p.join(",")).join(" ")}
                        fill="none"
                        stroke="orange"
                        strokeWidth={draftStrokeWidth}
                      />
                      {draftPoints.map((p, i) => (
                        <circle
                          key={i}
                          cx={p[0]}
                          cy={p[1]}
                          r={draftHandleRadius}
                          fill="orange"
                          stroke="#d97706"
                          strokeWidth={Math.max(2, draftStrokeWidth * 0.75)}
                        />
                      ))}
                    </>
                  )}

                  {orientationLassoPoints.length > 1 && (
                    <polygon
                      points={orientationLassoPoints
                        .map((p) => p.join(","))
                        .join(" ")}
                      fill="rgba(245,158,11,0.12)"
                      stroke="rgba(217,119,6,0.95)"
                      strokeWidth={orientationLassoStrokeWidth}
                      strokeDasharray={`${Math.max(8, 8 * scaleFactor)} ${Math.max(6, 6 * scaleFactor)}`}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ccc",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            height: "100%",
            minHeight: 0,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              border: "1px solid #ddd",
              padding: 12,
              flex: "0 0 auto",
              borderRadius: 10,
              background: selectedZone ? "#f8fbff" : "#fff",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Selected Zone</h3>

            {!selectedZone && <div>No zone selected</div>}

            {selectedZone && (
              <>
                <div style={{ marginBottom: 10, fontWeight: 700 }}>
                  Zone {selectedZone.zone_id}
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 14,
                      color: "#555",
                    }}
                  >
                    Orientation
                  </label>
                  <select
                    value={
                      selectedZone.orientation == null
                        ? ""
                        : String(selectedZone.orientation)
                    }
                    onChange={(e) =>
                      updateSelectedZoneOrientation(e.target.value)
                    }
                    style={{ padding: 8, width: "100%" }}
                    disabled={showOrientationPanel}
                  >
                    {ORIENTATION_SELECT_OPTIONS.map((option) => (
                      <option
                        key={option.value || "unassigned"}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

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
                  {showOrientationPanel
                    ? "Orientation tool is active. Draw a freehand lasso, review selected zones, then confirm."
                    : editMode === "move"
                      ? "Drag a white handle to move a vertex, or drag inside the selected zone to move the whole zone."
                      : "Click near one of the selected zone's edges to insert a vertex."}
                </div>

                {selectedVertexIndex !== null && !showOrientationPanel && (
                  <div style={{ marginTop: 8, fontSize: 14, color: "#555" }}>
                    Selected vertex: {selectedVertexIndex + 1}
                  </div>
                )}
              </>
            )}
          </div>

          <div
            style={{
              border: "1px solid #ddd",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              flex: "1 1 0",
              borderRadius: 10,
              background: "#fff",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Zones</h3>

            {zones.length === 0 ? (
              <div>No zones yet</div>
            ) : (
              <div
                ref={zonesListRef}
                style={{
                  display: "grid",
                  gap: 8,
                  overflowY: "auto",
                  minHeight: 0,
                  paddingRight: 4,
                }}
              >
                {zones
                  .slice()
                  .sort((a, b) => a.zone_id - b.zone_id)
                  .map((z) => {
                    const selected = z.zone_id === selectedZoneId;
                    const candidate = orientationCandidateSet.has(z.zone_id);
                    const hovered = hoveredZoneId === z.zone_id;

                    return (
                      <div
                        key={z.zone_id}
                        ref={selected ? selectedZoneRowRef : null}
                        onMouseEnter={() => setHoveredZoneId(z.zone_id)}
                        onMouseLeave={() =>
                          setHoveredZoneId((prev) =>
                            prev === z.zone_id ? null : prev,
                          )
                        }
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          border: candidate
                            ? "2px solid #d97706"
                            : selected
                              ? "2px solid #2563eb"
                              : hovered
                                ? "1px solid #93c5fd"
                                : "1px solid #ddd",
                          background: selected
                            ? "#eff6ff"
                            : hovered
                              ? "#f8fbff"
                              : "#fff",
                          borderRadius: 10,
                          padding: 8,
                          transition:
                            "border-color 0.12s ease, background 0.12s ease",
                          boxShadow: selected
                            ? "inset 4px 0 0 #2563eb"
                            : "none",
                        }}
                      >
                        <button
                          onClick={() => selectZone(z.zone_id)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            fontWeight: selected || candidate ? 700 : 500,
                            textAlign: "left",
                            flex: 1,
                          }}
                        >
                          <div>Zone {z.zone_id}</div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#666",
                              marginTop: 2,
                            }}
                          >
                            {z.orientation
                              ? `Orientation: ${getOrientationLabel(z.orientation)}`
                              : "Orientation: Unassigned"}
                          </div>
                        </button>
                        <button onClick={() => deleteZone(z.zone_id)}>
                          Delete
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function centroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 };

  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p[0], y: acc.y + p[1] }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function isCentroidInPolygon(points, polygonPoints) {
  if (
    !polygonPoints ||
    polygonPoints.length < 3 ||
    !points ||
    points.length === 0
  ) {
    return false;
  }

  const c = centroid(points);
  return isPointInPolygon([c.x, c.y], polygonPoints);
}

function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function findBestEdgeInsertIndex(points, clickPoint, maxDistance = 18) {
  if (!points || points.length < 2) return null;

  let bestIndex = null;
  let bestDistance = Infinity;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const distance = pointToSegmentDistance(clickPoint, a, b);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i + 1;
    }
  }

  if (bestDistance > maxDistance) return null;
  return bestIndex;
}

function pointToSegmentDistance(p, a, b) {
  const px = p[0];
  const py = p[1];
  const ax = a[0];
  const ay = a[1];
  const bx = b[0];
  const by = b[1];

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}
