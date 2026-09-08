from fastapi import FastAPI, File, HTTPException, UploadFile

from .providers import DevelopmentDetector, DevelopmentSegmenter
from .schemas import DetectionRequest, DetectionResponse, ServiceStatus

app = FastAPI(title="editorial-motion vision service", version="0.1.0")
detector = DevelopmentDetector()
segmenter = DevelopmentSegmenter()


@app.get("/health", response_model=ServiceStatus)
def health() -> ServiceStatus:
    return ServiceStatus(service="vision-service", provider=detector.name, status="ok")


@app.post("/v1/detect", response_model=DetectionResponse)
async def detect(request: DetectionRequest, image: UploadFile = File(...)) -> DetectionResponse:
    content = await image.read()
    try:
        detections = detector.detect(content, request.labels)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return DetectionResponse(detections=detections)


@app.post("/v1/segment")
async def segment(image: UploadFile = File(...)) -> dict[str, list]:
    content = await image.read()
    try:
        masks = segmenter.segment(content, [])
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"masks": [mask.model_dump() for mask in masks]}
