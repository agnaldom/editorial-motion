import numpy as np
from PIL import Image

from app.mask_refinement import refine_mask


def _mask(width: int, height: int, pixels: dict[tuple[int, int], int]) -> Image.Image:
    values = np.zeros((height, width), dtype=np.uint8)
    for (x, y), value in pixels.items():
        values[y, x] = value
    return Image.fromarray(values, mode="L")


def test_hole_fill_closes_interior_gaps() -> None:
    # Quadro 12x12 com contorno 3px e buraco 6x6 no meio (estrutura >2px
    # sobrevive ao opening de elemento estruturante em cruz).
    pixels = {}
    for x in range(12):
        for y in range(12):
            if x < 3 or x >= 9 or y < 3 or y >= 9:
                pixels[(x, y)] = 255
    refined = np.asarray(refine_mask(_mask(12, 12, pixels)), dtype=np.uint8)
    assert refined[5, 5] == 255
    assert refined.sum() == 12 * 12 * 255


def test_small_noise_components_are_removed() -> None:
    # Quadrado grande + pixel isolado de ruído (min_area default 16).
    pixels = {(x, y): 255 for x in range(20, 40) for y in range(20, 40)}
    pixels[(0, 0)] = 255
    refined = np.asarray(refine_mask(_mask(64, 64, pixels)), dtype=np.uint8)
    assert refined[0, 0] == 0
    assert refined[30, 30] == 255


def test_dimensions_are_preserved() -> None:
    mask = Image.new("L", (37, 23), 0)
    refined = refine_mask(mask)
    assert refined.size == (37, 23)


def test_clean_rectangle_keeps_region_and_dims() -> None:
    mask = Image.new("L", (32, 32), 0)
    for x in range(8, 24):
        for y in range(8, 24):
            mask.putpixel((x, y), 255)
    refined = refine_mask(mask)
    assert refined.size == (32, 32)
    values = np.asarray(refined, dtype=np.uint8)
    # Núcleo preservado; o opening pode arredondar quinas convexas em ~1px.
    assert np.all(values[10:22, 10:22] == 255)
    assert values.sum() >= 255 * (16 * 16 - 16)
