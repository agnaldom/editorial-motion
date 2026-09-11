import io
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.saliency import foreground_saliency


def render(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def subject_scene() -> Image.Image:
    """Fundo homogêneo com um objeto saliente central."""
    image = Image.new("RGB", (320, 180), (244, 241, 234))
    image.paste((39, 76, 99), (110, 50, 210, 130))
    return image


def test_mascara_cobre_o_objeto_saliente_com_bbox_plausivel():
    result = foreground_saliency(render(subject_scene()))
    bbox = result.bbox
    assert abs(bbox["x"] - 110 / 320) < 0.06
    assert abs(bbox["y"] - 50 / 180) < 0.06
    assert abs(bbox["width"] - 100 / 320) < 0.12
    assert abs(bbox["height"] - 80 / 180) < 0.12
    assert 0.05 < result.coverage < 0.6


def test_feather_deixa_borda_suave():
    result = foreground_saliency(render(subject_scene()))
    values = np.asarray(result.mask, dtype=np.uint8)
    edge = values[40, 160]  # fora do objeto, perto da borda
    assert 0 < edge < 255, f"esperado valor intermediário no feather, got {edge}"


def test_mascara_no_tamanho_real_da_imagem():
    result = foreground_saliency(render(subject_scene()))
    assert result.mask.size == (320, 180)


def test_imagem_uniforme_sem_saliencia_rejeitada():
    with pytest.raises(ValueError):
        foreground_saliency(render(Image.new("RGB", (32, 18), (244, 241, 234))))


def test_endpoint_saliency_retorna_png_com_metadados():
    client = TestClient(main.app)
    response = client.post("/v1/saliency/foreground", files=[("image", ("source.png", render(subject_scene()), "image/png"))])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    mask = Image.open(io.BytesIO(response.content)).convert("L")
    assert mask.size == (320, 180)
    metadata = json.loads(response.headers["x-saliency-metadata"])
    assert 0 <= metadata["bbox"]["x"] <= 1
    assert 0 < metadata["coverage"] < 1


def test_endpoint_saliency_rejeita_imagem_invalida():
    client = TestClient(main.app)
    response = client.post("/v1/saliency/foreground", files=[("image", ("bad.png", b"not an image", "image/png"))])
    assert response.status_code == 400
