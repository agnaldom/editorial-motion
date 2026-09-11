import json
from dataclasses import asdict
from io import BytesIO

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from PIL import Image

from .inpainting import build_removal_mask, create_inpainter
from .layers import extract_layer
from .providers import create_detector, create_segmenter, create_vectorizer
from .saliency import foreground_saliency
from .schemas import Detection, DetectionRequest, DetectionResponse, ServiceStatus, VectorizeResponse

app = FastAPI(title="editorial-motion vision service", version="0.1.0")
detector = create_detector()
segmenter = create_segmenter()
inpainter = create_inpainter()
vectorizer = create_vectorizer()


@app.get("/health", response_model=ServiceStatus)
def health() -> ServiceStatus:
    return ServiceStatus(service="vision-service", provider=f"{detector.name}/{segmenter.name}/{inpainter.name}/{vectorizer.name}", status="ok")


@app.post("/v1/detect")
async def detect(image: UploadFile = File(...), labels: str = Form(...)) -> dict[str, list]:
    content = await image.read()
    try:
        parsed_labels = json.loads(labels)
        if not isinstance(parsed_labels, list) or not all(isinstance(label, str) for label in parsed_labels):
            raise ValueError("labels must be a JSON list of strings")
        if not 1 <= len(parsed_labels) <= 10:
            raise ValueError("labels must contain between 1 and 10 items")
        detections = detector.detect(content, parsed_labels)
    except (ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"detections": [detection.model_dump() for detection in detections]}


@app.post("/v1/scene/analyze", response_model=SceneAnalysisResponse)
async def scene_analyze(image: UploadFile = File(...)) -> SceneAnalysisResponse:
    """Análise heurística CPU-only (issue #119): regiões salientes sem LLM."""
    content = await image.read()
    try:
        return analyze_scene(content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/segment")
async def segment(
    image: UploadFile = File(...),
    detections: str = Form(default="[]"),
) -> dict[str, list]:
    content = await image.read()
    try:
        parsed = [Detection.model_validate(item) for item in json.loads(detections)]
        masks = segmenter.segment(content, parsed)
    except (ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"masks": [mask.model_dump() for mask in masks]}


@app.post("/v1/inpaint")
async def inpaint(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    additional_masks: list[UploadFile] = File(default=[]),
) -> Response:
    try:
        source = Image.open(BytesIO(await image.read())).convert("RGB")
        removal = build_removal_mask(
            [Image.open(BytesIO(await item.read())).convert("L") for item in [mask, *additional_masks]]
        )
        result = inpainter.inpaint(source, removal)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    buffer = BytesIO()
    result.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")


@app.post(
    "/v1/layers/extract",
    responses={200: {"content": {"image/png": {}}, "headers": {"X-Layer-Metadata": {"schema": {"type": "string"}}}}},
)
async def extract(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    element_id: str = Form(min_length=1),
    label: str = Form(default=""),
    z_index: int = Form(default=0),
    mask_ref: str = Form(default=""),
    layer_ref: str = Form(default=""),
) -> Response:
    try:
        source = Image.open(BytesIO(await image.read())).convert("RGB")
        segmentation = Image.open(BytesIO(await mask.read())).convert("L")
        layer, metadata = extract_layer(
            source,
            segmentation,
            element_id=element_id,
            z_index=z_index,
            mask_ref=mask_ref or f"masks/{element_id}.png",
            layer_ref=layer_ref or f"layers/{element_id}.png",
            label=label or element_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    buffer = BytesIO()
    layer.save(buffer, format="PNG")
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={"X-Layer-Metadata": json.dumps(asdict(metadata))},
    )


@app.post("/v1/routes/vectorize", response_model=VectorizeResponse)
async def vectorize(mask: UploadFile = File(...), source_ref: str = Form(default="route-raster")) -> VectorizeResponse:
    segmentation = Image.open(BytesIO(await mask.read())).convert("L")
    width, height = segmentation.size
    paths = vectorizer.vectorize(segmentation)
    return VectorizeResponse(
        paths=[{"points": path.points, "source_ref": source_ref} for path in paths],
        width=width,
        height=height,
    )


@app.post(
    "/v1/saliency/foreground",
    responses={200: {"content": {"image/png": {}}, "headers": {"X-Saliency-Metadata": {"schema": {"type": "string"}}}}},
)
async def saliency(image: UploadFile = File(...)) -> Response:
    """Máscara de foreground saliente com feather (issue #121, depth layering)."""
    try:
        result = foreground_saliency(await image.read())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    buffer = BytesIO()
    result.mask.save(buffer, format="PNG")
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={"X-Saliency-Metadata": json.dumps({"bbox": result.bbox, "coverage": result.coverage})},
    )
