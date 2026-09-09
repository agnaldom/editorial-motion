import json
from io import BytesIO

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from PIL import Image

from .inpainting import create_inpainter
from .providers import create_detector, create_segmenter
from .schemas import Detection, DetectionRequest, DetectionResponse, ServiceStatus

app = FastAPI(title="editorial-motion vision service", version="0.1.0")
detector = create_detector()
segmenter = create_segmenter()
inpainter = create_inpainter()


@app.get("/health", response_model=ServiceStatus)
def health() -> ServiceStatus:
    return ServiceStatus(service="vision-service", provider=f"{detector.name}/{segmenter.name}/{inpainter.name}", status="ok")


@app.post("/v1/detect", response_model=DetectionResponse)
async def detect(request: DetectionRequest, image: UploadFile = File(...)) -> DetectionResponse:
    content = await image.read()
    try:
        detections = detector.detect(content, request.labels)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return DetectionResponse(detections=detections)


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
async def inpaint(image: UploadFile = File(...), mask: UploadFile = File(...)) -> Response:
    try:
        source = Image.open(BytesIO(await image.read())).convert("RGB")
        removal = Image.open(BytesIO(await mask.read())).convert("L")
        result = inpainter.inpaint(source, removal)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    buffer = BytesIO()
    result.save(buffer, format="PNG")
    return Response(content=buffer.getvalue(), media_type="image/png")
