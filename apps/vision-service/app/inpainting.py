from typing import Protocol

import os

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
    """Determinístico sem ML (issue #150): preenchimento por BFS a partir do anel
    em volta da máscara (nearest-fill) num proxy reduzido — remove o objeto de
    verdade até um provider real (LaMa/Diffusers) ser configurado."""

    name = "development-blurfill"

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        if image.size != mask.size:
            raise ValueError("image and inpainting mask must have the same size")
        mask_l = mask.convert("L")
        mask_arr = np.asarray(mask_l) > 127
        if not mask_arr.any():
            return image.copy()
        max_side = 256
        scale = min(1.0, max_side / max(image.size))
        work_size = (max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
        small = np.asarray(image.convert("RGB").resize(work_size, Image.BILINEAR), dtype=np.uint8)
        small_mask = np.asarray(mask_l.resize(work_size, Image.NEAREST)) > 127
        filled = _nearest_fill(small, small_mask)
        result = Image.fromarray(filled, mode="RGB").filter(ImageFilter.GaussianBlur(radius=1))
        return result.resize(image.size, Image.BILINEAR).convert(image.mode)


def _nearest_fill(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Multi-source BFS: pixels mascarados recebem a cor do pixel conhecido mais próximo."""
    from collections import deque

    height, width, _ = rgb.shape
    remaining = mask.copy()
    filled = rgb.copy()
    queue: deque[tuple[int, int]] = deque()
    for y, x in zip(*np.where(~remaining)):
        queue.append((int(y), int(x)))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and remaining[ny, nx]:
                remaining[ny, nx] = False
                filled[ny, nx] = filled[y, x]
                queue.append((ny, nx))
    return filled


class LammaInpainter:
    """LaMa inpainting via simple-lama-inpainting (self-hosted default)."""

    name = "lama"

    def __init__(self):
        try:
            from simple_lama_inpainting import SimpleLamaInpainting
        except ImportError as error:
            raise ImportError("LaMa provider could not import simple_lama_inpainting. ML extras are required: pip install -r requirements-ml.txt") from error
        self._lama = SimpleLamaInpainting()

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        if image.size != mask.size:
            raise ValueError("image and inpainting mask must have the same size")
        result = self._lama(image.convert("RGB"), mask.convert("L"))
        return result.convert(image.mode)


class DiffusersInpainter:
    """Configurable Diffusers inpainting fallback."""

    name = "diffusers"

    def __init__(self, model_id: str | None = None):
        try:
            import torch
            from diffusers import StableDiffusionInpaintPipeline
        except ImportError as error:
            raise ImportError("Diffusers provider could not import torch/diffusers. ML extras are required: pip install -r requirements-ml.txt") from error
        self._torch = torch
        model_id = model_id or os.environ.get("DIFFUSERS_INPAINT_MODEL", "stabilityai/stable-diffusion-2-inpainting")
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        self.pipe = StableDiffusionInpaintPipeline.from_pretrained(model_id, torch_dtype=dtype).to(
            "cuda" if torch.cuda.is_available() else "cpu"
        )

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        if image.size != mask.size:
            raise ValueError("image and inpainting mask must have the same size")
        with self._torch.no_grad():
            result = self.pipe(prompt="", image=image.convert("RGB"), mask_image=dilate_mask(mask, radius=2), num_inference_steps=20).images[0]
        return result.convert(image.mode)


class FallbackInpainter:
    def __init__(self, primary: Inpainter, fallback: Inpainter):
        self.primary = primary
        self.fallback = fallback
        self.name = f"{getattr(primary, 'name', type(primary).__name__)}+{getattr(fallback, 'name', type(fallback).__name__)}"

    def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        try:
            return self.primary.inpaint(image, mask)
        except Exception:
            return self.fallback.inpaint(image, mask)


def create_inpainter() -> Inpainter:
    # ponytail: repo default boots without ML extras; production sets INPAINT_PROVIDER=lama explicitly (SPEC §7.4).
    provider = os.environ.get("INPAINT_PROVIDER", "copy").strip().lower()
    if provider == "lama":
        return FallbackInpainter(LammaInpainter(), DiffusersInpainter())
    if provider == "diffusers":
        return DiffusersInpainter()
    if provider in ("", "copy", "development", "none"):
        return DevelopmentInpainter()
    raise ValueError(f"Unknown INPAINT_PROVIDER: {provider}")

