from typing import Protocol

import numpy as np
from PIL import Image, ImageFilter


class Inpainter(Protocol):
    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image: ...


def dilate_mask(mask: Image.Image, radius: int = 2) -> Image.Image:
    if radius < 0:
        raise ValueError("dilation radius cannot be negative")
    if radius == 0:
        return mask.convert("L")
    return mask.convert("L").filter(ImageFilter.MaxFilter(radius * 2 + 1))


def build_removal_mask(masks: list[Image.Image], radius: int = 2) -> Image.Image:
    if not masks:
        raise ValueError("at least one mask is required")
    size = masks[0].size
    union = np.zeros((size[1], size[0]), dtype=np.uint8)
    for mask in masks:
        current = np.asarray(mask.convert("L").resize(size, Image.Resampling.NEAREST), dtype=np.uint8)
        union = np.maximum(union, current)
    return dilate_mask(Image.fromarray(union, mode="L"), radius)


class DevelopmentInpainter:
    """Deterministic fallback that preserves source pixels until a real provider exists."""

    name = "development-copy"

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        if image.size != mask.size:
            raise ValueError("image and inpainting mask must have the same size")
        return image.copy()


class FallbackInpainter:
    def __init__(self, primary: Inpainter, fallback: Inpainter):
        self.primary = primary
        self.fallback = fallback

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        try:
            return self.primary.inpaint(image, mask)
        except Exception:
            return self.fallback.inpaint(image, mask)
