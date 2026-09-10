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


def test_junction_branches_are_covered() -> None:
    values = np.zeros((7, 7), dtype=np.uint8)
    values[3, 1:6] = 255
    values[0:4, 3] = 255
    paths = vectorize_route_mask(Image.fromarray(values), "t.png")
    assert len(paths) == 2
    assert all(len(path.points) == 2 for path in paths)
    spans = {tuple(sorted(path.points)) for path in paths}
    assert ((1 / 6, 0.5), (5 / 6, 0.5)) in spans  # horizontal bar traced straight through the junction
    assert ((0.5, 0.0), (0.5, 0.5)) in spans  # vertical arm


def test_closed_ring_traces_as_single_path() -> None:
    values = np.zeros((9, 9), dtype=np.uint8)
    values[2, 2:7] = 255
    values[6, 2:7] = 255
    values[2:7, 2] = 255
    values[2:7, 6] = 255
    paths = vectorize_route_mask(Image.fromarray(values), "ring.png")
    assert len(paths) == 1
    assert len(paths[0].points) >= 4


def test_thick_diagonal_simplifies_with_rdp() -> None:
    values = np.zeros((12, 12), dtype=np.uint8)
    for index in range(2, 10):
        values[index, index] = 255
        values[index, index + 1] = 255
    paths = vectorize_route_mask(Image.fromarray(values), "diagonal.png")
    assert len(paths) == 1
    assert 2 <= len(paths[0].points) <= 4
