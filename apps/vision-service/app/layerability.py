"""Layerability engine (SPEC V2 §13, issue #143).

Score 0..1 por elemento: o quanto o objeto merece virar layer independente.
Sinais já computados na análise (fill, edge density, overlap, área) pesam numa
fórmula determinística; textos e rotas têm teto (ficam anexados / região).
"""

import numpy as np

ROUTE_CAP = 0.5
TEXT_CAP = 0.2
BACKGROUND_SCORE = 0.0

WEIGHT_UNIFORMITY = 0.4
WEIGHT_EDGE = 0.15
WEIGHT_INDEPENDENCE = 0.25
WEIGHT_SIZE = 0.2


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def score_layerability(
    *,
    kind: str,
    area_ratio: float,
    uniformity: float,
    edge_density: float,
    overlap_ratio: float,
    confidence: float,
) -> float:
    """kind: blob | route | text; uniformity = 1 - std de luminância interna (solidão da
    segmentação — robusto onde a máscara de saliência global é esparsa); overlap_ratio =
    fração da caixa coberta por outras."""
    if kind == "text":
        return TEXT_CAP
    size = 0.3 + 0.7 * _clamp(area_ratio / 0.05)
    independence = 1.0 - _clamp(overlap_ratio)
    raw = (
        WEIGHT_UNIFORMITY * _clamp(uniformity)
        + WEIGHT_EDGE * _clamp(edge_density / 0.15)
        + WEIGHT_INDEPENDENCE * independence
        + WEIGHT_SIZE * size
    )
    score = raw * (0.75 + 0.25 * confidence)
    if kind == "route":
        return round(min(score, ROUTE_CAP), 3)
    return round(_clamp(score), 3)


def overlap_ratio(box: tuple[int, int, int, int], others: list[tuple[int, int, int, int, int]]) -> float:
    """Fração da área de `box` coberta pela união das outras caixas."""
    x0, y0, x1, y1 = box
    area = max(1, (x1 - x0) * (y1 - y0))
    covered = 0
    for ox0, oy0, ox1, oy1, _ in others:
        ix0, iy0 = max(x0, ox0), max(y0, oy0)
        ix1, iy1 = min(x1, ox1), min(y1, oy1)
        if ix1 > ix0 and iy1 > iy0:
            covered += (ix1 - ix0) * (iy1 - iy0)
    return _clamp(covered / area)


def background_recoverability(arr: np.ndarray, mask: np.ndarray, edge_mask: np.ndarray | None = None, radius: int = 6) -> float:
    """SPEC V2 §16 (issue #150): quão bem o fundo atrás do objeto pode ser reconstruído.
    Anel ao redor da máscara: uniformidade de luminância (textura rasa → alta) penalizada
    por densidade de bordas (outros objetos cruzando o anel → baixa)."""
    if not mask.any():
        return 0.0
    grown = mask.copy()
    for _ in range(max(1, radius)):
        expanded = grown.copy()
        expanded[1:, :] |= grown[:-1, :]
        expanded[:-1, :] |= grown[1:, :]
        expanded[:, 1:] |= grown[:, :-1]
        expanded[:, :-1] |= grown[:, 1:]
        grown = expanded
    ring = grown & ~mask
    if not ring.any():
        return 0.5
    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    uniformity = 1.0 - _clamp(float(lum[ring].std()) / 60)
    edge_penalty = 0.0
    if edge_mask is not None and edge_mask.any():
        edge_penalty = min(1.0, float(edge_mask[ring].mean()) * 3)
    return round(_clamp(uniformity * (1 - 0.5 * edge_penalty)), 3)
