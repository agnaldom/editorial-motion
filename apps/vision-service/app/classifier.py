"""Classificador de cena multi-rótulo (SPEC V2 §10, issue #142).

Sinais CPU computados sobre o proxy reduzido alimentam uma tabela de pesos
determinística por tipo de cena. A confiança é a fatia do score total — sem
hardcode de imagem: os mesmos sinais valem para foto, mapa, screenshot etc.
"""

from dataclasses import dataclass

import numpy as np

SCENE_TYPES = [
    "photo", "portrait", "landscape", "map", "diagram", "infographic",
    "editorial-collage", "illustration", "document", "screenshot",
    "architecture", "product", "data-visualization", "abstract", "mixed",
]

ROUTE_ASPECT = 3.5
TOP_K = 3

# pesos por tipo: sinal negativo penaliza o tipo.
WEIGHTS: dict[str, dict[str, float]] = {
    "photo": {"colorful": 0.6, "center_big": 0.5, "organic": 0.6, "text": -0.2, "rect": -0.2, "n_blobs": 0.2, "route": -0.3},
    "portrait": {"center_big": 0.9, "colorful": 0.4, "organic": 0.3, "text": -0.2, "n_blobs": -0.1},
    "landscape": {"colorful": 0.6, "organic": 0.7, "flat": 0.3, "n_blobs": 0.3, "route": -0.2},
    "map": {"route": 1.5, "route_and_blobs": 1.4, "flat": 0.4, "colorful": 0.3},
    "diagram": {"route": 0.3, "route_and_blobs": 0.5, "rect": 0.7, "n_blobs": 0.6, "text": 0.2, "flat": 0.3, "center_big": 0.2},
    "infographic": {"text": 0.9, "rect": 0.6, "flat": 0.5, "n_blobs": 0.5, "colorful": 0.3},
    "editorial-collage": {"n_blobs": 0.8, "organic": 0.6, "colorful": 0.5, "center_big": 0.3, "flat": -0.2},
    "illustration": {"colorful": 0.7, "organic": 0.8, "flat": 0.2},
    "document": {"text": 1.0, "flat": 0.8, "colorful": -0.3, "n_blobs": 0.1},
    "screenshot": {"rect": 0.9, "flat": 0.8, "text": 0.5, "colorful": -0.2, "n_blobs": 0.4},
    "architecture": {"rect": 0.6, "flat": 0.4, "colorful": 0.3, "center_big": 0.4},
    "product": {"center_big": 0.8, "rect": 0.5, "flat": 0.6, "colorful": 0.4, "organic": -0.2},
    "data-visualization": {"text": 0.6, "rect": 0.7, "route": 0.3, "flat": 0.5, "n_blobs": 0.4},
    "abstract": {"colorful": 0.6, "organic": 0.6, "n_blobs": 0.4, "center_big": -0.2, "text": -0.3},
    "mixed": {},
}


@dataclass(frozen=True)
class SceneSignals:
    flat: float
    text: float
    route: float
    n_blobs: float
    colorful: float
    rect: float
    organic: float
    center_big: float
    route_and_blobs: float

    def as_dict(self) -> dict[str, float]:
        return {field: getattr(self, field) for field in ("flat", "text", "route", "n_blobs", "colorful", "rect", "organic", "center_big", "route_and_blobs")}


def _colorfulness(arr: np.ndarray, mask: np.ndarray) -> float:
    # Hasler-Süsstrunk sobre pixels salientes; ~0 para cinza, 80+ para foto colorida.
    pixels = arr[mask] if mask.any() else arr.reshape(-1, 3)
    if len(pixels) == 0:
        return 0.0
    rg = pixels[:, 0] - pixels[:, 1]
    yb = 0.5 * (pixels[:, 0] + pixels[:, 1]) - pixels[:, 2]
    return float(np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2))


def compute_signals(
    arr: np.ndarray,
    mask: np.ndarray,
    edge_mask: np.ndarray,
    kept: list[tuple[int, int, int, int, int]],
    bands: list[tuple[int, int, int, int]],
    grown: np.ndarray | None = None,
) -> SceneSignals:
    height, width, _ = arr.shape
    total = width * height
    box_area = sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1, _ in kept)
    band_area = sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1 in bands)

    routes = 0
    rects = 0
    organics = 0
    fill_source = grown if grown is not None else mask
    for x0, y0, x1, y1, _ in kept:
        bw, bh = x1 - x0, y1 - y0
        aspect = max(bw, bh) / max(1, min(bw, bh))
        # rota: ESPARSA na máscara crua (linha fina); barras sólidas de chart não são rotas
        raw_fill = float(mask[y0:y1, x0:x1].sum()) / (bw * bh)
        if aspect >= ROUTE_ASPECT and raw_fill < 0.7:
            routes += bw * bh
        # rect/organic usam a máscara dilatada: a crua percentil-p90 subestima interiores
        fill = float(fill_source[y0:y1, x0:x1].sum()) / (bw * bh)
        if fill > 0.8 and aspect <= 2.5:
            rects += 1
        if fill < 0.6 or aspect > 2.5:
            organics += 1

    center_big = 0.0
    if kept:
        x0, y0, x1, y1, _ = kept[0]
        cx, cy = (x0 + x1) / 2 / width, (y0 + y1) / 2 / height
        center_big = 1.0 - min(1.0, float(np.hypot(cx - 0.5, cy - 0.5) / np.hypot(0.5, 0.5)))

    return SceneSignals(
        flat=round(float(1 - min(1.0, edge_mask.mean() * 4)), 4),
        text=round(min(1.0, band_area / total * 8), 4),
        route=round(min(1.0, routes / total * 12), 4),
        n_blobs=round(min(1.0, len(kept) / 6), 4),
        colorful=round(min(1.0, _colorfulness(arr, mask) / 80), 4),
        rect=round(rects / max(1, len(kept)), 4),
        organic=round(organics / max(1, len(kept)), 4),
        center_big=round(center_big, 4),
        route_and_blobs=round(min(min(1.0, routes / total * 12), min(1.0, len(kept) / 6)), 4),
    )


def classify_scene(
    arr: np.ndarray,
    mask: np.ndarray,
    edge_mask: np.ndarray,
    kept: list[tuple[int, int, int, int, int]],
    bands: list[tuple[int, int, int, int]],
    grown: np.ndarray | None = None,
) -> list[dict]:
    """Retorna até TOP_K classificações {type, confidence} ordenadas por score."""
    signals = compute_signals(arr, mask, edge_mask, kept, bands, grown).as_dict()
    raw: dict[str, float] = {}
    for scene_type in SCENE_TYPES:
        score = sum(weight * signals.get(signal, 0.0) for signal, weight in WEIGHTS[scene_type].items())
        raw[scene_type] = max(0.0, score)
    total = sum(raw.values())
    if total <= 0:
        return [{"type": "mixed", "confidence": 1.0}]
    ranked = sorted(raw.items(), key=lambda item: item[1], reverse=True)[:TOP_K]
    return [{"type": scene_type, "confidence": round(score / total, 3)} for scene_type, score in ranked]
