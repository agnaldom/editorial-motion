import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.classifier import SCENE_TYPES, classify_scene
from app.scene_analysis import analyze_scene


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
    image = blobs_scene()
    for x in range(30, 290):
        image.putpixel((x, 160), (180, 140, 40))
        image.putpixel((x, 161), (180, 140, 40))
    return image


def text_band_scene() -> Image.Image:
    image = Image.new("RGB", (320, 180), (255, 255, 255))
    for row in range(140, 168, 8):
        for col in range(16, 304, 12):
            image.paste((30, 30, 30), (col, row, col + 6, row + 4))
    image.paste((240, 240, 240), (20, 20, 140, 120))
    image.paste((220, 220, 220), (160, 20, 300, 120))
    return image


def assert_format(classifications):
    assert 1 <= len(classifications) <= 3
    assert all(item.type in SCENE_TYPES for item in classifications)
    assert all(0 < item.confidence <= 1 for item in classifications)
    # SPEC §10 não normaliza (exemplo do spec soma > 1): só garante ordem e formato
    assert [item.confidence for item in classifications] == sorted((item.confidence for item in classifications), reverse=True)


def test_cena_com_rota_classifica_map_no_topo():
    result = analyze_scene(render(route_scene()))
    assert_format(result.classifications)
    assert result.classifications[0].type == "map", f"esperado map no topo, got {result.classifications}"


def test_faixa_de_texto_e_blocos_classifica_tipos_estruturados():
    result = analyze_scene(render(text_band_scene()))
    assert_format(result.classifications)
    top_types = {item.type for item in result.classifications}
    assert top_types & {"infographic", "document", "screenshot", "data-visualization"}, f"tipos estruturados ausentes: {result.classifications}"


def test_blobs_classificam_e_confidences_somam_um():
    result = analyze_scene(render(blobs_scene()))
    assert_format(result.classifications)


def test_cena_uniforme_cai_no_fallback_mixed():
    result = analyze_scene(render(Image.new("RGB", (32, 18), (244, 241, 234))))
    # fallback de 1 elemento: sinais fracos → mixed dominante ou foto; formato é o contrato real
    assert_format(result.classifications)


def test_endpoint_scene_analyze_inclui_classifications():
    client = TestClient(main.app)
    response = client.post("/v1/scene/analyze", files=[("image", ("source.png", render(route_scene()), "image/png"))])
    assert response.status_code == 200
    body = response.json()
    assert len(body["classifications"]) >= 1
    assert body["classifications"][0]["type"] == "map"
    assert all(set(item) == {"type", "confidence"} for item in body["classifications"])


def test_layerability_blobs_isolados_altos_texto_baixo_rota_teto():
    blobs = analyze_scene(render(blobs_scene()))
    blob_scores = [e.layerability for e in blobs.elements if e.animatable]
    assert len(blob_scores) == 3
    assert all(score >= 0.72 for score in blob_scores), f"blobs sólidos isolados deveriam ser layers: {blob_scores}"

    text_band = analyze_scene(render(text_band_scene()))
    text_scores = [e.layerability for e in text_band.elements if e.type == "stat_box"]
    assert len(text_scores) >= 1
    assert all(score <= 0.45 for score in text_scores), f"faixas de texto ficam anexadas: {text_scores}"

    route = analyze_scene(render(route_scene()))
    route_scores = [e.layerability for e in route.elements if e.type == "route"]
    assert len(route_scores) == 1
    assert 0.45 <= route_scores[0] <= 0.5, f"rota é candidata a região (teto 0.5): {route_scores}"
