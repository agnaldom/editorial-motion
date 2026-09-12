from dataclasses import dataclass

import numpy as np
from PIL import Image

from .layerability import background_recoverability
from .mask_refinement import refine_mask


@dataclass(frozen=True)
class LayerMetadata:
    element_id: str
    bbox: dict[str, float]
    anchor: dict[str, float]
    z_index: int
    mask_ref: str
    layer_ref: str
    label: str = ""
    recoverability: float = 0.0


def _mask_array(mask: Image.Image, size: tuple[int, int]) -> np.ndarray:
    grayscale = mask.convert("L").resize(size, Image.Resampling.NEAREST)
    return np.asarray(grayscale, dtype=np.uint8)


def normalized_bbox(mask: Image.Image) -> dict[str, float]:
    values = np.asarray(mask.convert("L"), dtype=np.uint8)
    ys, xs = np.where(values > 0)
    if len(xs) == 0:
        raise ValueError("segmentation mask is empty")
    width, height = mask.size
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    return {"x": left / width, "y": top / height, "width": (right - left) / width, "height": (bottom - top) / height}


def extract_layer(
    image: Image.Image,
    mask: Image.Image,
    element_id: str,
    z_index: int,
    mask_ref: str,
    layer_ref: str,
    label: str = "",
) -> tuple[Image.Image, LayerMetadata]:
    mask = refine_mask(mask)
    source = image.convert("RGBA")
    alpha = _mask_array(mask, source.size)
    if not np.any(alpha):
        raise ValueError("segmentation mask is empty")
    source.putalpha(Image.fromarray(alpha, mode="L"))
    bbox = normalized_bbox(Image.fromarray(alpha, mode="L"))
    alpha_bool = np.asarray(alpha, dtype=bool)
    recoverability = background_recoverability(np.asarray(image.convert("RGB"), dtype=np.float32), alpha_bool)
    return source, LayerMetadata(
        element_id=element_id,
        bbox=bbox,
        anchor={"x": bbox["x"] + bbox["width"] / 2, "y": bbox["y"] + bbox["height"] / 2},
        z_index=z_index,
        mask_ref=mask_ref,
        layer_ref=layer_ref,
        label=label,
        recoverability=recoverability,
    )


def union_masks(masks: list[Image.Image], size: tuple[int, int] | None = None) -> Image.Image:
    if not masks:
        raise ValueError("at least one mask is required")
    target_size = size or masks[0].size
    result = np.zeros((target_size[1], target_size[0]), dtype=np.uint8)
    for mask in masks:
        result = np.maximum(result, _mask_array(mask, target_size))
    return Image.fromarray(result, mode="L")
