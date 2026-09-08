from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class VectorPath:
    points: list[tuple[float, float]]
    source_ref: str


def _components(values: np.ndarray) -> list[list[tuple[int, int]]]:
    height, width = values.shape
    seen: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for y, x in zip(*np.where(values > 0)):
        point = (int(y), int(x))
        if point in seen:
            continue
        stack = [point]
        seen.add(point)
        component: list[tuple[int, int]] = []
        while stack:
            current_y, current_x = stack.pop()
            component.append((current_y, current_x))
            for next_y in range(current_y - 1, current_y + 2):
                for next_x in range(current_x - 1, current_x + 2):
                    if 0 <= next_y < height and 0 <= next_x < width and values[next_y, next_x] > 0 and (next_y, next_x) not in seen:
                        seen.add((next_y, next_x))
                        stack.append((next_y, next_x))
        components.append(component)
    return components


def _component_polyline(component: list[tuple[int, int]]) -> list[tuple[int, int]]:
    ys = [point[0] for point in component]
    xs = [point[1] for point in component]
    if max(xs) - min(xs) >= max(ys) - min(ys):
        buckets = sorted(set(xs))
        return [(int(np.median([y for y, x in component if x == value])), value) for value in buckets]
    buckets = sorted(set(ys))
    return [(value, int(np.median([x for y, x in component if y == value]))) for value in buckets]


def vectorize_route_mask(mask: Image.Image, source_ref: str, min_area: int = 2) -> list[VectorPath]:
    values = np.asarray(mask.convert("L"), dtype=np.uint8)
    height, width = values.shape
    paths: list[VectorPath] = []
    for component in _components(values):
        if len(component) < min_area:
            continue
        points = _component_polyline(component)
        normalized = [(x / max(width - 1, 1), y / max(height - 1, 1)) for y, x in points]
        if len(normalized) >= 2:
            paths.append(VectorPath(points=normalized, source_ref=source_ref))
    return paths


def svg_path(path: VectorPath, width: int, height: int) -> str:
    if not path.points:
        raise ValueError("route path is empty")
    commands = [f"M {path.points[0][0] * width:.2f} {path.points[0][1] * height:.2f}"]
    commands.extend(f"L {x * width:.2f} {y * height:.2f}" for x, y in path.points[1:])
    return " ".join(commands)
