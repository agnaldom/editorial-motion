from pydantic import BaseModel, Field


class NormalizedBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class Detection(BaseModel):
    label: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    bbox: NormalizedBox


class SegmentationMask(BaseModel):
    label: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    mask_ref: str = Field(min_length=1)


class DetectionRequest(BaseModel):
    labels: list[str] = Field(min_length=1, max_length=10)


class DetectionResponse(BaseModel):
    detections: list[Detection] = Field(max_length=10)


class ServiceStatus(BaseModel):
    service: str
    provider: str
    status: str
