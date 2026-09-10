import numpy as np
from PIL import Image

from app.layers import extract_layer, normalized_bbox, union_masks


def test_normalized_bbox_uses_image_coordinates() -> None:
    mask = Image.fromarray(np.pad(np.ones((2, 3), dtype=np.uint8) * 255, ((1, 1), (2, 1))))
    assert normalized_bbox(mask) == {"x": 0.3333333333333333, "y": 0.25, "width": 0.5, "height": 0.5}


def test_extract_layer_sets_mask_as_alpha_and_metadata() -> None:
    image = Image.new("RGB", (16, 16), "red")
    # Máscara sólida 8x8 centralizada: refino (opening) remove estruturas <3px,
    # então a fixture precisa de uma região mais espessa que o SE.
    mask = Image.fromarray(np.pad(np.ones((8, 8), dtype=np.uint8) * 255, ((4, 4), (4, 4))))
    layer, metadata = extract_layer(image, mask, "map", 2, "masks/map.png", "layers/map.png")
    assert layer.mode == "RGBA"
    assert layer.getpixel((0, 0))[3] == 0
    assert layer.getpixel((8, 8))[3] == 255
    assert metadata.element_id == "map"


def test_union_masks_combines_regions() -> None:
    first = Image.fromarray(np.pad(np.ones((1, 1), dtype=np.uint8) * 255, ((0, 1), (0, 1))))
    second = Image.fromarray(np.pad(np.ones((1, 1), dtype=np.uint8) * 255, ((1, 0), (1, 0))))
    union = union_masks([first, second])
    assert np.count_nonzero(np.asarray(union)) == 2
