import io
import json

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.providers import DevelopmentSegmenter
from app.schemas import Detection, NormalizedBox


def png_bytes(width: int = 8, height: int = 6) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(np.zeros((height, width, 3), dtype=np.uint8), mode="RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def upload(content: bytes, field: str, filename: str) -> tuple:
    return (field, (filename, content, "image/png"))


def test_health_reports_provider_chain():
    client = TestClient(main.app)
    body = client.get("/health").json()
    assert body["service"] == "vision-service"
    assert body["status"] == "ok"
    assert "development-null" in body["provider"]


def test_segment_passes_detections_through_to_provider(monkeypatch):
    received: list[Detection] = []

    class StubSegmenter(DevelopmentSegmenter):
        def segment(self, image: bytes, detections: list[Detection]):
            received.extend(detections)
            return super().segment(image, detections)

    monkeypatch.setattr(main, "segmenter", StubSegmenter())
    client = TestClient(main.app)
    detections = [{"label": "China", "confidence": 0.9, "bbox": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}}]
    response = client.post(
        "/v1/segment",
        files=[upload(png_bytes(), "image", "source.png")],
        data={"detections": json.dumps(detections)},
    )
    assert response.status_code == 200
    assert response.json() == {"masks": []}
    assert received == [Detection(label="China", confidence=0.9, bbox=NormalizedBox(x=0.1, y=0.2, width=0.3, height=0.4))]


def test_segment_rejects_malformed_detections():
    client = TestClient(main.app)
    response = client.post(
        "/v1/segment",
        files=[upload(png_bytes(), "image", "source.png")],
        data={"detections": "not json"},
    )
    assert response.status_code == 400


def test_inpaint_returns_png_with_same_dimensions():
    client = TestClient(main.app)
    source = png_bytes(16, 12)
    mask = png_bytes(16, 12)
    response = client.post("/v1/inpaint", files=[upload(source, "image", "source.png"), upload(mask, "mask", "mask.png")])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    result = Image.open(io.BytesIO(response.content))
    assert result.size == (16, 12)


def test_inpaint_rejects_mismatched_sizes():
    client = TestClient(main.app)
    response = client.post("/v1/inpaint", files=[upload(png_bytes(16, 12), "image", "source.png"), upload(png_bytes(8, 8), "mask", "mask.png")])
    assert response.status_code == 400


def test_extract_layer_returns_rgba_png_with_metadata_header():
    import json as jsonlib

    client = TestClient(main.app)
    source = Image.new("RGB", (16, 12), "red")
    mask = Image.new("L", (16, 12), 0)
    for x in range(4, 12):
        for y in range(3, 9):
            mask.putpixel((x, y), 255)
    buffer = io.BytesIO()
    mask.save(buffer, format="PNG")
    response = client.post(
        "/v1/layers/extract",
        files=[upload(png_bytes(16, 12), "image", "source.png"), upload(buffer.getvalue(), "mask", "mask.png")],
        data={"element_id": "china", "label": "China silhouette", "z_index": "2"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    layer = Image.open(io.BytesIO(response.content)).convert("RGBA")
    assert layer.getpixel((0, 0))[3] == 0
    assert layer.getpixel((8, 6))[3] == 255
    metadata = jsonlib.loads(response.headers["x-layer-metadata"])
    assert metadata["element_id"] == "china"
    assert metadata["label"] == "China silhouette"
    assert metadata["z_index"] == 2
    assert abs(metadata["bbox"]["x"] - 0.25) < 0.01
    assert abs(metadata["bbox"]["width"] - 0.5) < 0.01


def test_extract_layer_rejects_empty_mask():
    client = TestClient(main.app)
    empty = Image.new("L", (8, 8), 0)
    buffer = io.BytesIO()
    empty.save(buffer, format="PNG")
    response = client.post(
        "/v1/layers/extract",
        files=[upload(png_bytes(8, 8), "image", "source.png"), upload(buffer.getvalue(), "mask", "mask.png")],
        data={"element_id": "china"},
    )
    assert response.status_code == 400


def test_vectorize_route_returns_normalized_paths():
    client = TestClient(main.app)
    mask = Image.new("L", (20, 10), 0)
    for x in range(2, 18):
        mask.putpixel((x, 5), 255)
    buffer = io.BytesIO()
    mask.save(buffer, format="PNG")
    response = client.post(
        "/v1/routes/vectorize",
        files=[upload(buffer.getvalue(), "mask", "route.png")],
        data={"source_ref": "route-raster.png"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["width"] == 20
    assert body["height"] == 10
    assert len(body["paths"]) == 1
    points = body["paths"][0]["points"]
    assert all(0 <= x <= 1 and 0 <= y <= 1 for x, y in points)
    assert len(points) >= 2
    assert body["paths"][0]["source_ref"] == "route-raster.png"
