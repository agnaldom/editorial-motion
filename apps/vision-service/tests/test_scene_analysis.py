import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.scene_analysis import analyze_scene

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"


def render(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def blobs_scene() -> Image.Image:
    image = Image.new("RGB", (320, 180), (244, 241, 234))
    for box, color in [
        ((20, 20, 110, 90), (39, 76, 99)),
        ((130, 30, 200, 150), (192, 86, 33)),
        ((220, 60, 300, 130), (47, 133, 90)),
    ]:
        image.paste(color, box)
    return image


def route_scene() -> Image.Image:
    image = Image.new("RGB", (320, 180), (244, 241, 234))
    for x in range(30, 290):
        image.putpixel((x, 90), (180, 140, 40))
        image.putpixel((x, 91), (180, 140, 40))
    return image


def test_blobs_scene_gera_multiplos_elementos_com_bboxes_plausiveis():
    result = analyze_scene(render(blobs_scene()))
    assert len(result.elements) >= 2
    by_type = {element.type for element in result.elements}
    assert by_type == {"photo"}
    boxes = sorted((element.bbox.x, element.bbox.y, element.bbox.width, element.bbox.height) for element in result.elements)
    expected = sorted([(20 / 320, 20 / 180, 90 / 320, 70 / 180), (130 / 320, 30 / 180, 70 / 320, 120 / 180), (220 / 320, 60 / 180, 80 / 320, 70 / 180)])
    for (x, y, w, h), (ex, ey, ew, eh) in zip(boxes, expected):
        assert abs(x - ex) < 0.08 and abs(y - ey) < 0.08
        assert abs(w - ew) < 0.12 and abs(h - eh) < 0.12
    assert all(element.animatable for element in result.elements)
    assert result.protectedRegions == []


def test_text_band_e_marcada_protegida():
    image = blobs_scene()
    for row in range(150, 172, 8):
        for col in range(16, 304, 12):
            image.paste((30, 30, 30), (col, row, col + 6, row + 4))
    result = analyze_scene(render(image))
    protected = [element for element in result.elements if element.protected]
    assert len(protected) >= 1
    assert all(element.type == "stat_box" for element in protected)
    assert all(element.motionRole == "protected" for element in protected)
    assert len(result.protectedRegions) >= 1
    band = protected[0].bbox
    assert band.y > 0.7 and band.width > 0.6
    assert any(element.animatable for element in result.elements)


def test_route_sem_blob_e_preservada_como_conector():
    result = analyze_scene(render(route_scene()))
    assert len(result.elements) == 1
    assert result.elements[0].type == "route"
    assert result.elements[0].motionRole == "connector"


def test_route_com_blob_composicao_map():
    image = blobs_scene()
    for x in range(30, 290):
        image.putpixel((x, 160), (180, 140, 40))
        image.putpixel((x, 161), (180, 140, 40))
    result = analyze_scene(render(image))
    assert result.compositionType == "map"
    assert any(element.type == "route" for element in result.elements)
    assert any(element.type == "map_region" for element in result.elements)


def test_imagem_uniforme_cai_no_fallback_de_elemento_unico():
    result = analyze_scene(render(Image.new("RGB", (64, 36), (244, 241, 234))))
    assert len(result.elements) == 1
    element = result.elements[0]
    assert element.id == "composition"
    assert element.bbox.width == 1.0 and element.bbox.height == 1.0
    assert result.protectedRegions == []


def test_imagem_vazia_rejeitada():
    with pytest.raises(ValueError):
        analyze_scene(b"")


def test_endpoint_scene_analyze_retorna_json_do_contrato():
    client = TestClient(main.app)
    response = client.post("/v1/scene/analyze", files=[("image", ("source.png", render(blobs_scene()), "image/png"))])
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "1"
    assert body["source"]["width"] == 320
    assert len(body["elements"]) >= 2
    assert all(set(element) >= {"id", "label", "type", "bbox", "confidence", "zIndex", "animatable", "protected", "motionRole", "source"} for element in body["elements"])


def test_endpoint_scene_analyze_rejeita_imagem_invalida():
    client = TestClient(main.app)
    response = client.post("/v1/scene/analyze", files=[("image", ("bad.png", b"not an image", "image/png"))])
    assert response.status_code == 400


def test_fixture_editorial_collage_gera_multiplos_elementos():
    fixture = FIXTURES / "paper-collage-people-documents.png"
    if not fixture.exists():
        pytest.skip("fixture não gerada localmente")
    result = analyze_scene(fixture.read_bytes())
    assert len(result.elements) >= 2
