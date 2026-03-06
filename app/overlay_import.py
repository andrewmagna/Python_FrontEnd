from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np


def polygon_centroid(points: List[List[int]]) -> tuple[float, float]:
    if not points:
        return (0.0, 0.0)
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def import_polygons_from_overlay(overlay_path: Path) -> Dict[str, Any]:
    if not overlay_path.exists():
        raise FileNotFoundError(f"Overlay image not found: {overlay_path}")

    img = cv2.imread(str(overlay_path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to load overlay image")

    height, width = img.shape[:2]

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # Red in HSV wraps around hue, so use two ranges
    lower_red_1 = np.array([0, 80, 50], dtype=np.uint8)
    upper_red_1 = np.array([12, 255, 255], dtype=np.uint8)

    lower_red_2 = np.array([165, 80, 50], dtype=np.uint8)
    upper_red_2 = np.array([180, 255, 255], dtype=np.uint8)

    mask1 = cv2.inRange(hsv, lower_red_1, upper_red_1)
    mask2 = cv2.inRange(hsv, lower_red_2, upper_red_2)
    red_mask = cv2.bitwise_or(mask1, mask2)

    # Thicken / clean the boundary mask a bit
    kernel = np.ones((3, 3), np.uint8)
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    red_mask = cv2.dilate(red_mask, kernel, iterations=1)

    # Invert so enclosed regions become white "blobs"
    inv = cv2.bitwise_not(red_mask)

    # Flood fill from borders to remove background, leaving enclosed cells
    flood = inv.copy()
    ff_mask = np.zeros((height + 2, width + 2), np.uint8)
    cv2.floodFill(flood, ff_mask, (0, 0), 0)

    enclosed = flood

    # Small cleanup
    enclosed = cv2.morphologyEx(enclosed, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(enclosed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons: List[Dict[str, Any]] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # Filter noise and giant background-like regions
        if area < 1000:
            continue
        if area > width * height * 0.95:
            continue

        epsilon = 0.003 * cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, epsilon, True)

        points = [[int(pt[0][0]), int(pt[0][1])] for pt in approx]

        if len(points) < 3:
            continue

        polygons.append(
            {
                "zone_id": 0,  # temporary, assigned below
                "points": points,
            }
        )

    # Sort top-to-bottom, then left-to-right using centroid
    polygons.sort(key=lambda z: (polygon_centroid(z["points"])[1], polygon_centroid(z["points"])[0]))

    for idx, poly in enumerate(polygons, start=1):
        poly["zone_id"] = idx

    return {
        "image_size": {"width": width, "height": height},
        "zones": polygons,
    }