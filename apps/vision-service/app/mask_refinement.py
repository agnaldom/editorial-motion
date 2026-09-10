"""Mask refinement pipeline (SPEC §8 stage 4): denoise, fill holes, filter
small components, and smooth boundaries before layer extraction.

Pure numpy/Pillow — no scipy/OpenCV dependency (CPU base image stays light).
"""

import numpy as np
from PIL import Image


def _binary(values: np.ndarray) -> np.ndarray:
    return values > 127


def _dilate(binary: np.ndarray) -> np.ndarray:
    out = binary.copy()
    out[1:, :] |= binary[:-1, :]
    out[:-1, :] |= binary[1:, :]
    out[:, 1:] |= binary[:, :-1]
    out[:, :-1] |= binary[:, 1:]
    return out


def _erode(binary: np.ndarray) -> np.ndarray:
    out = binary.copy()
    out[1:, :] &= binary[:-1, :]
    out[:-1, :] &= binary[1:, :]
    out[:, 1:] &= binary[:, :-1]
    out[:, :-1] &= binary[:, 1:]
    return out


def _open(binary: np.ndarray) -> np.ndarray:
    return _dilate(_erode(binary))


def _close(binary: np.ndarray) -> np.ndarray:
    return _erode(_dilate(binary))


def _fill_holes(binary: np.ndarray) -> np.ndarray:
    # Flood fill the background from the image borders; whatever background
    # remains unreachable is an interior hole and becomes foreground.
    height, width = binary.shape
    reachable = np.zeros_like(binary)
    stack: list[tuple[int, int]] = []
    for x in range(width):
        for y in (0, height - 1):
            if not binary[y, x] and not reachable[y, x]:
                stack.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if not binary[y, x] and not reachable[y, x]:
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= height or x < 0 or x >= width or binary[y, x] or reachable[y, x]:
            continue
        reachable[y, x] = True
        stack.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
    return binary | (~reachable & ~binary)


def _components(binary: np.ndarray) -> list[tuple[np.ndarray, int]]:
    labels = np.zeros(binary.shape, dtype=np.int32)
    components: list[tuple[np.ndarray, int]] = []
    next_label = 0
    ys, xs = np.where(binary)
    for start_y, start_x in zip(ys, xs):
        if labels[start_y, start_x]:
            continue
        next_label += 1
        pixels = [(int(start_y), int(start_x))]
        labels[start_y, start_x] = next_label
        region = []
        while pixels:
            y, x = pixels.pop()
            region.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < binary.shape[0] and 0 <= nx < binary.shape[1] and binary[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = next_label
                    pixels.append((ny, nx))
        coords = np.array(region)
        components.append((coords, len(region)))
    return components


def _filter_small_components(binary: np.ndarray, min_area: int) -> np.ndarray:
    keep = np.zeros_like(binary)
    for coords, area in _components(binary):
        if area >= min_area:
            keep[coords[:, 0], coords[:, 1]] = True
    return keep


def _smooth(binary: np.ndarray, passes: int = 2) -> np.ndarray:
    # Box blur via two separable moving averages, then threshold. O threshold
    # 0.4 (vs 0.5) preserva quinas de regiões limpas: dois passes compõem um
    # kernel efetivo ~5x5, onde a quina de um retângulo vale 4/9 ≈ 0.444.
    values = binary.astype(np.float64)
    for _ in range(passes):
        values = (values + np.roll(values, 1, axis=0) + np.roll(values, -1, axis=0)) / 3
        values = (values + np.roll(values, 1, axis=1) + np.roll(values, -1, axis=1)) / 3
    return values >= 0.4


def refine_mask(mask: Image.Image, min_area: int | None = None) -> Image.Image:
    """Apply the full refinement pipeline; output keeps input dimensions.

    `min_area` defaults to a resolution-aware floor (0.01% of the image, min 4
    pixels) so small unit-test-scale masks survive while production noise dies.
    """
    grayscale = np.asarray(mask.convert("L"), dtype=np.uint8)
    width, height = mask.size
    area_floor = max(4, int(width * height * 0.0001)) if min_area is None else min_area
    binary = _binary(grayscale)
    # ponytail: ordem fixa open -> holes -> componentes -> close -> smooth;
    # upgrade: parametrizar kernel/passes quando houver tuning por provider.
    binary = _open(binary)
    binary = _fill_holes(binary)
    binary = _filter_small_components(binary, area_floor)
    binary = _close(binary)
    binary = _smooth(binary)
    return Image.fromarray((binary * 255).astype(np.uint8), mode="L")
