import numpy as np
from PIL import Image

from app.routes import svg_path, vectorize_route_mask


def test_vectorizes_connected_route_components() -> None:
    values = np.zeros((5, 8), dtype=np.uint8)
    values[2, 1:7] = 255
    paths = vectorize_route_mask(Image.fromarray(values), "routes/original.png")
    assert len(paths) == 1
    assert len(paths[0].points) >= 2
    assert paths[0].source_ref == "routes/original.png"


def test_svg_path_scales_normalized_points() -> None:
    values = np.zeros((2, 2), dtype=np.uint8)
    values[0, :] = 255
    path = vectorize_route_mask(Image.fromarray(values), "route.png")[0]
    result = svg_path(path, 100, 50)
    assert result.startswith("M ")
    assert "L " in result


def test_small_components_are_filtered() -> None:
    values = np.zeros((3, 3), dtype=np.uint8)
    values[1, 1] = 255
    assert vectorize_route_mask(Image.fromarray(values), "route.png") == []
