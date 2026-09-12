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


def test_background_recoverability_alto_em_fundo_uniforme_baixo_em_textura():
    import numpy as np
    from app.layerability import background_recoverability

    arr = np.zeros((60, 100, 3), dtype=np.float32) + 200
    mask = np.zeros((60, 100), dtype=bool)
    mask[20:40, 40:60] = True
    high = background_recoverability(arr, mask)
    assert high >= 0.8, f"fundo uniforme deveria ser bem recuperável: {high}"

    busy = arr.copy()
    busy[:, ::4] = 30  # textura densa no anel
    low = background_recoverability(busy, mask)
    assert low < high


def test_extract_layer_inclui_recoverability_no_metadata():
    image = Image.new("RGB", (60, 40), (200, 200, 200))
    for x in range(20, 40):
        for y in range(10, 30):
            image.putpixel((x, y), (30, 60, 90))
    mask = Image.new("L", (60, 40), 0)
    for x in range(20, 40):
        for y in range(10, 30):
            mask.putpixel((x, y), 255)
    _, metadata = extract_layer(image, mask, element_id="elm", z_index=1, mask_ref="m", layer_ref="l")
    assert 0 <= metadata.recoverability <= 1
    assert metadata.recoverability >= 0.7, f'recuperável em fundo uniforme: {metadata.recoverability}'


def test_development_inpainter_preenche_mascara_com_borrado_deterministico():
    from app.inpainting import DevelopmentInpainter

    image = Image.new("RGB", (160, 160), (200, 200, 200))
    for x in range(70, 90):
        for y in range(70, 90):
            image.putpixel((x, y), (255, 0, 0))
    mask = Image.new("L", (160, 160), 0)
    for x in range(70, 90):
        for y in range(70, 90):
            mask.putpixel((x, y), 255)
    result = DevelopmentInpainter().inpaint(image, mask)
    assert result.size == image.size
    center = result.getpixel((80, 80))
    assert center != (255, 0, 0), "objeto deveria ser removido"
    assert abs(center[0] - 200) < 12 and abs(center[1] - 200) < 12, f"nearest-fill usa o anel: {center}"
    again = DevelopmentInpainter().inpaint(image, mask)
    import io
    buf1, buf2 = io.BytesIO(), io.BytesIO()
    result.save(buf1, format="PNG")
    again.save(buf2, format="PNG")
    assert buf1.getvalue() == buf2.getvalue(), "blurfill é determinístico"
