import numpy as np
from PIL import Image

from app.inpainting import DevelopmentInpainter, FallbackInpainter, build_removal_mask, dilate_mask


def test_dilate_mask_expands_edges() -> None:
    mask = Image.fromarray(np.pad(np.ones((1, 1), dtype=np.uint8) * 255, ((2, 2), (2, 2))))
    assert np.count_nonzero(np.asarray(dilate_mask(mask, 1))) > np.count_nonzero(np.asarray(mask))


def test_build_removal_mask_requires_masks() -> None:
    try:
        build_removal_mask([])
        assert False
    except ValueError as error:
        assert "at least one" in str(error)


def test_development_inpainter_preserves_size() -> None:
    image = Image.new("RGB", (4, 4), "red")
    mask = Image.new("L", (4, 4), 255)
    result = DevelopmentInpainter().inpaint(image, mask)
    assert result.size == image.size


def test_fallback_inpainter_uses_fallback_after_provider_failure() -> None:
    class Broken:
        def inpaint(self, image: Image.Image, mask: Image.Image) -> Image.Image:
            raise RuntimeError("provider unavailable")

    image = Image.new("RGB", (2, 2), "blue")
    result = FallbackInpainter(Broken(), DevelopmentInpainter()).inpaint(image, Image.new("L", (2, 2)))
    assert result.getpixel((0, 0)) == (0, 0, 255)
