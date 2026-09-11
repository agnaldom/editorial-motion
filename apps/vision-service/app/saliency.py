"""Mapa de saliência para depth layering (issue #121).

Estimativa grosseira CPU-only de foreground vs. background: reutiliza a
saliência por gradiente + cor do scene_analysis, mantém os componentes
centrais mais salientes (até ~40% da imagem) e aplica feather gaussiano
para recorte suave. Sem modelos pesados.
"""

from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter

PROXY_MAX = 384
FEATHER_RADIUS = 3
MAX_FOREGROUND_COVERAGE = 0.4
MIN_COMPONENT_AREA = 0.02
CENTER_BIAS = 0.25  # deslocamento máximo do centroide em direção ao centro


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def _components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """Componentes conexos (4-vizinhança) → caixas (x0, y0, x1, y1, pixels)."""
    height, width = mask.shape
    visited = np.zeros_like(mask)
    boxes: list[tuple[int, int, int, int, int]] = []
    for start_y in range(height):
        for start_x in np.flatnonzero(mask[start_y] & ~visited[start_y]):
            if visited[start_y, start_x]:
                continue
            stack = [(int(start_y), int(start_x))]
            visited[start_y, start_x] = True
            x0 = x1 = int(start_x)
            y0 = y1 = int(start_y)
            count = 0
            while stack:
                cy, cx = stack.pop()
                count += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            boxes.append((x0, y0, x1 + 1, y1 + 1, count))
    return boxes


@dataclass(frozen=True)
class SaliencyResult:
    mask: Image.Image  # máscara L com feather, no tamanho real da imagem
    bbox: dict[str, float]
    coverage: float


def foreground_saliency(image: bytes) -> SaliencyResult:
    if not image:
        raise ValueError("image is empty")
    try:
        pil = Image.open(BytesIO(image)).convert("RGB")
    except Exception as error:
        raise ValueError(f"cannot decode image: {error}") from error
    real_width, real_height = pil.size
    scale = PROXY_MAX / max(real_width, real_height)
    proxy = pil.resize((max(1, round(real_width * scale)), max(1, round(real_height * scale))), Image.BILINEAR) if scale < 1 else pil
    arr = np.asarray(proxy, dtype=np.float32)
    height, width, _ = arr.shape
    total = width * height

    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    grad = np.hypot(np.abs(np.diff(lum, axis=1, prepend=lum[:, :1])), np.abs(np.diff(lum, axis=0, prepend=lum[:1, :])))
    border = np.concatenate([arr[0, :, :], arr[-1, :, :], arr[:, 0, :], arr[:, -1, :]])
    color_dist = np.abs(arr - border.mean(axis=0)).sum(axis=2)
    mask = (grad > np.percentile(grad, 75)) | (color_dist > np.percentile(color_dist, 90))
    mask = _dilate(mask, 2)
    # Preenche buracos internos: componentes de fundo que não tocam a borda
    # (interior de blobs salientes) integram o foreground.
    for x0, y0, x1, y1, _ in _components(~mask):
        if x0 > 0 and y0 > 0 and x1 < width and y1 < height:
            mask[y0:y1, x0:x1] = True

    # Componentes centrais e salientes, do maior para o menor, até o teto de cobertura.
    cx, cy = width / 2, height / 2
    candidates = []
    for box in _components(mask):
        x0, y0, x1, y1, count = box
        area = (x1 - x0) * (y1 - y0)
        if area < MIN_COMPONENT_AREA * total:
            continue
        bcx, bcy = (x0 + x1) / 2, (y0 + y1) / 2
        centrality = 1 - min(1, np.hypot(bcx - cx, bcy - cy) / np.hypot(cx, cy))
        candidates.append((area * (1 + CENTER_BIAS * centrality), box))
    candidates.sort(key=lambda item: item[0], reverse=True)

    foreground = np.zeros((height, width), dtype=bool)
    covered = 0.0
    for _, (x0, y0, x1, y1, _) in candidates:
        if covered >= MAX_FOREGROUND_COVERAGE:
            break
        region = np.zeros((height, width), dtype=bool)
        region[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
        foreground |= region
        covered = float(foreground.sum()) / total

    if not foreground.any():
        raise ValueError("no salient foreground found")

    mask_img = Image.fromarray((foreground * 255).astype("uint8"), mode="L")
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(FEATHER_RADIUS))
    if scale < 1:
        mask_img = mask_img.resize((real_width, real_height), Image.BILINEAR)

    values = np.asarray(mask_img, dtype=np.uint8)
    ys, xs = np.where(values > 127)
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    return SaliencyResult(
        mask=mask_img,
        bbox={"x": left / real_width, "y": top / real_height, "width": (right - left) / real_width, "height": (bottom - top) / real_height},
        coverage=float((values > 127).sum()) / (real_width * real_height),
    )
