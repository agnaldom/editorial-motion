"""Análise de cena heurística CPU-only (issue #119).

Decompõe a imagem em regiões salientes reais (blobs, faixas de label,
rotas) sem nenhum modelo ML — apenas numpy/Pillow. Quando não encontra
estrutura suficiente, cai no contrato legado de 1 elemento full-frame.
"""

from io import BytesIO

import numpy as np
from PIL import Image

from .classifier import classify_scene
from .layerability import overlap_ratio, score_layerability
from .schemas import (
    NormalizedBox,
    ProtectedRegionModel,
    SceneAnalysisResponse,
    SceneElementModel,
    SourceDimensions,
)

PROXY_MAX = 384  # lado maior do proxy de análise
MIN_AREA = 0.015  # caixas menores que 1.5% da imagem são ruído
MAX_AREA = 0.85
ROUTE_ASPECT = 3.5  # alongada o suficiente = rota/linha
TEXT_ASPECT = 2.5  # faixa larga e baixa = zona de label/número
TEXT_FILL = 0.5  # preenchimento baixo + bordas = texto, não blob


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


def _iou(a: tuple[int, int, int, int, int], b: tuple[int, int, int, int, int]) -> float:
    ax0, ay0, ax1, ay1, _ = a
    bx0, by0, bx1, by1, _ = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    intersection = (ix1 - ix0) * (iy1 - iy0)
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - intersection
    return intersection / union if union > 0 else 0.0


def analyze_scene(image: bytes) -> SceneAnalysisResponse:
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

    # Saliência: gradiente de luminância + distância de cor ao fundo (bordas).
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    grad = np.hypot(np.abs(np.diff(lum, axis=1, prepend=lum[:, :1])), np.abs(np.diff(lum, axis=0, prepend=lum[:1, :])))
    border = np.concatenate([arr[0, :, :], arr[-1, :, :], arr[:, 0, :], arr[:, -1, :]])
    color_dist = np.abs(arr - border.mean(axis=0)).sum(axis=2)
    edge_mask = grad > np.percentile(grad, 75)
    mask = edge_mask | (color_dist > np.percentile(color_dist, 90))

    # Faixas de label/números: runs de linhas com alta densidade de borda que
    # se espalham por boa parte da largura viram zonas protegidas e saem da mask.
    text_specs: list[dict] = []
    row_density = edge_mask.mean(axis=1)
    band_start: int | None = None
    for y, density in enumerate(row_density):
        if density > 0.04 and band_start is None:
            band_start = y
        elif density <= 0.04 and band_start is not None:
            if y - band_start >= 3:
                text_specs.append((band_start, y))
            band_start = None
    if band_start is not None and len(row_density) - band_start >= 3:
        text_specs.append((band_start, len(row_density)))
    bands: list[tuple[int, int, int, int]] = []
    for y0, y1 in text_specs:
        col_density = edge_mask[y0:y1].mean(axis=0)
        cols = np.flatnonzero(col_density > 0.05)
        if len(cols) >= 0.5 * width:
            bands.append((int(cols[0]), y0, int(cols[-1]) + 1, y1))
            mask[y0:y1, :] = False

    # Dilatação une marcas próximas (glifos de um label viram uma faixa só).
    # Dilatação gentil: uni glifos de label sem colar blobs/rotas vizinhos (dataset #152).
    grown = _dilate(mask, max(2, round(min(height, width) / 80)))
    boxes = [box for box in _components(grown) if MIN_AREA * total <= (box[2] - box[0]) * (box[3] - box[1]) <= MAX_AREA * total]
    boxes.sort(key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
    kept: list[tuple[int, int, int, int, int]] = []
    for box in boxes:
        if all(_iou(box, other) <= 0.8 for other in kept):
            kept.append(box)
    kept = kept[:10]

    specs: list[dict] = [
        {
            "kind": "text",
            "bbox": NormalizedBox(x=round(x0 / width, 4), y=round(y0 / height, 4), width=round((x1 - x0) / width, 4), height=round((y1 - y0) / height, 4)),
            "confidence": 0.7,
            "layerability": 0.2,
        }
        for x0, y0, x1, y1 in bands
    ]
    for index, (x0, y0, x1, y1, _) in enumerate(kept):
        bw, bh = x1 - x0, y1 - y0
        aspect = max(bw, bh) / max(1, min(bw, bh))
        fill = float(mask[y0:y1, x0:x1].sum()) / (bw * bh)
        edge_density = float(edge_mask[y0:y1, x0:x1].mean())
        confidence = round(min(1.0, 0.6 + 0.3 * min(1.0, edge_density / 0.15)), 2)
        bbox = NormalizedBox(x=round(x0 / width, 4), y=round(y0 / height, 4), width=round(bw / width, 4), height=round(bh / height, 4))
        if aspect >= ROUTE_ASPECT:
            kind = "route"
        elif aspect >= TEXT_ASPECT and bw >= bh and fill < TEXT_FILL and edge_density > 0.08:
            kind = "text"
        else:
            kind = "blob"
        others = [box for j, box in enumerate(kept) if j != index]
        # uniformidade no NÚCLEO da caixa (margin afastada): caixas vêm da máscara
        # dilatada e incluem fundo; o interior é o proxy robusto da solidão da segmentação
        mx, my = (x1 - x0) // 8, (y1 - y0) // 8
        box_lum = (arr[y0 + my:y1 - my, x0 + mx:x1 - mx] @ np.array([0.299, 0.587, 0.114], dtype=np.float32))
        uniformity = float(1 - min(1.0, box_lum.std() / 40)) if box_lum.size > 0 else 0.0
        specs.append({
            "kind": kind,
            "bbox": bbox,
            "confidence": confidence,
            "layerability": score_layerability(
                kind=kind,
                area_ratio=(bw * bh) / total,
                uniformity=uniformity,
                edge_density=edge_density,
                overlap_ratio=overlap_ratio((x0, y0, x1, y1), others),
                confidence=confidence,
            ),
        })

    has_route = any(spec["kind"] == "route" for spec in specs)
    blob_rank = 0
    elements: list[SceneElementModel] = []
    protected: list[ProtectedRegionModel] = []
    for index, spec in enumerate(specs):
        kind = spec["kind"]
        blob_rank += kind == "blob"
        label = f"Route {index + 1}" if kind == "route" else f"Label zone {index + 1}" if kind == "text" else f"Region {blob_rank}"
        element_type = {"route": "route", "text": "stat_box", "blob": "map_region" if has_route else "photo"}[kind]
        elements.append(SceneElementModel(
            id=f"region-{index + 1}", label=label, type=element_type, bbox=spec["bbox"], confidence=spec["confidence"],
            zIndex=index + 1, animatable=kind != "text", protected=kind == "text",
            motionRole={"route": "connector", "text": "protected", "blob": "primary" if blob_rank <= 2 else "secondary"}[kind],
            source="detector",
            layerability=spec.get("layerability", 0.0),
        ))
        if kind == "text":
            protected.append(ProtectedRegionModel(id=f"region-{index + 1}", label=label, bbox=spec["bbox"], reason="heuristic numeric/label zone"))

    blob_count = sum(1 for spec in specs if spec["kind"] == "blob")
    composition = "photo"
    if has_route and blob_count > 0:
        composition = "map"
    elif blob_count >= 3:
        composition = "editorial-collage"
    elif len(elements) > 1:
        composition = "mixed"

    # Contrato: no máximo 10 elementos (schema). Bands vêm primeiro; componentes
    # já estão ordenados por área, então o corte descarta os menores.
    elements = elements[:10]
    protected = [region for region in protected if any(region.id == element.id for element in elements)]

    classifications = classify_scene(arr, mask, edge_mask, kept, bands, grown)

    # Fallback legado: sem nenhum elemento animável, mantém o contrato de 1 elemento.
    if not any(element.animatable for element in elements):
        elements = [SceneElementModel(
            id="composition", label="Full composition", type="photo",
            bbox=NormalizedBox(x=0.0, y=0.0, width=1.0, height=1.0),
            confidence=1.0, zIndex=1, animatable=True, protected=False, motionRole="primary", source="detector",
        )]
        protected = []
        composition = "photo"

    return SceneAnalysisResponse(
        version="1",
        sceneId="scene01",
        source=SourceDimensions(width=real_width, height=real_height, aspectRatio=real_width / real_height),
        compositionType=composition,
        classifications=classifications,
        elements=elements,
        protectedRegions=protected,
    )
