from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class VectorPath:
    points: list[tuple[float, float]]
    source_ref: str = ""


def _zhang_suen(binary: np.ndarray) -> np.ndarray:
    """Morphological thinning to a 1px skeleton (Zhang-Suen), vectorized with numpy."""
    skeleton = binary.astype(np.uint8).copy()
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            padded = np.pad(skeleton, 1)
            ring = (
                padded[:-2, 1:-1],  # p2 north
                padded[:-2, 2:],    # p3 north-east
                padded[1:-1, 2:],   # p4 east
                padded[2:, 2:],     # p5 south-east
                padded[2:, 1:-1],   # p6 south
                padded[2:, :-2],    # p7 south-west
                padded[1:-1, :-2],  # p8 west
                padded[:-2, :-2],   # p9 north-west
            )
            count = sum(ring)
            transitions = sum(((before == 0) & (after == 1)).astype(np.uint8) for before, after in zip(ring, ring[1:] + (ring[0],)))
            if step == 0:
                deletable = (ring[0] * ring[2] * ring[4] == 0) & (ring[2] * ring[4] * ring[6] == 0)
            else:
                deletable = (ring[0] * ring[2] * ring[6] == 0) & (ring[0] * ring[4] * ring[6] == 0)
            mask = (skeleton == 1) & (count >= 2) & (count <= 6) & (transitions == 1) & deletable
            if mask.any():
                skeleton[mask] = 0
                changed = True
    return skeleton


def _trace_skeleton(skeleton: np.ndarray) -> list[list[tuple[int, int]]]:
    """Walk skeleton pixels into polylines, splitting at junctions and closing loops."""
    pixels = set(zip(*np.where(skeleton > 0)))

    def neighbors_of(point: tuple[int, int]) -> list[tuple[int, int]]:
        found = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not (dy or dx):
                    continue
                other = (point[0] + dy, point[1] + dx)
                if other not in pixels:
                    continue
                # drop diagonal bridges: a diagonal step between perpendicular arms always
                # has an orthogonal projection pixel; a genuine diagonal line has neither
                if dy and dx and ((point[0] + dy, point[1]) in pixels or (point[0], point[1] + dx) in pixels):
                    continue
                found.append(other)
        return found

    neighbors = {point: neighbors_of(point) for point in pixels}
    visited: set[frozenset[tuple[int, int]]] = set()
    traces: list[list[tuple[int, int]]] = []

    def walk(start: tuple[int, int], first: tuple[int, int]) -> list[tuple[int, int]]:
        trace = [start, first]
        visited.add(frozenset((start, first)))
        previous, current = start, first
        while True:
            options = [other for other in neighbors[current] if frozenset((current, other)) not in visited]
            if not options:
                return trace
            direction = (current[0] - previous[0], current[1] - previous[1])
            nxt = max(options, key=lambda other: (other[0] - current[0]) * direction[0] + (other[1] - current[1]) * direction[1])
            visited.add(frozenset((current, nxt)))
            trace.append(nxt)
            previous, current = current, nxt

    for point in pixels:
        if len(neighbors[point]) != 2:
            for first in neighbors[point]:
                if frozenset((point, first)) not in visited:
                    traces.append(walk(point, first))
    for point in pixels:  # closed loops: pixels with 2 neighbors and no visited edge
        if len(neighbors[point]) == 2 and all(frozenset((point, other)) not in visited for other in neighbors[point]):
            traces.append(walk(point, neighbors[point][0])[:-1])
    return traces


def _rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker simplification; epsilon in normalized units."""
    if len(points) < 3:
        return points
    (x0, y0), (x1, y1) = points[0], points[-1]
    chord_x, chord_y = x1 - x0, y1 - y0
    chord = (chord_x ** 2 + chord_y ** 2) ** 0.5
    if chord == 0:
        distances = [((x - x0) ** 2 + (y - y0) ** 2) ** 0.5 for x, y in points[1:-1]]
    else:
        distances = [abs((x - x0) * chord_y - (y - y0) * chord_x) / chord for x, y in points[1:-1]]
    if not distances:
        return points
    split = int(np.argmax(distances)) + 1
    if distances[split - 1] <= epsilon:
        return [points[0], points[-1]]
    return _rdp(points[: split + 1], epsilon)[:-1] + _rdp(points[split:], epsilon)


class SkeletonRouteVectorizer:
    """Default RouteVectorizer: Zhang-Suen thinning + branch tracing + RDP simplification."""

    name = "skeleton-rdp"

    def __init__(self, epsilon: float = 0.01, min_area: int = 2):
        self.epsilon = epsilon
        self.min_area = min_area

    def vectorize(self, route_mask: Image.Image) -> list[VectorPath]:
        values = np.asarray(route_mask.convert("L"), dtype=np.uint8)
        height, width = values.shape
        skeleton = _zhang_suen(values > 0)
        paths: list[VectorPath] = []
        for trace in _trace_skeleton(skeleton):
            if len(trace) < self.min_area:
                continue
            normalized = [(x / max(width - 1, 1), y / max(height - 1, 1)) for y, x in trace]
            simplified = _rdp(normalized, self.epsilon)
            if len(simplified) >= 2:
                paths.append(VectorPath(points=simplified))
        return paths


def vectorize_route_mask(mask: Image.Image, source_ref: str, min_area: int = 2) -> list[VectorPath]:
    paths = SkeletonRouteVectorizer(min_area=min_area).vectorize(mask)
    return [VectorPath(points=path.points, source_ref=source_ref) for path in paths]


def svg_path(path: VectorPath, width: int, height: int) -> str:
    if not path.points:
        raise ValueError("route path is empty")
    commands = [f"M {path.points[0][0] * width:.2f} {path.points[0][1] * height:.2f}"]
    commands.extend(f"L {x * width:.2f} {y * height:.2f}" for x, y in path.points[1:])
    return " ".join(commands)
