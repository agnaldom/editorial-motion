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
    # PNG L da máscara em base64, quando o provider gera os bytes (ex.: SAM 2).
    # mask_ref continua apontando para o arquivo server-side; o b64 evita roundtrip extra.
    mask_png_b64: str | None = None


class DetectionRequest(BaseModel):
    labels: list[str] = Field(min_length=1, max_length=10)


class DetectionResponse(BaseModel):
    detections: list[Detection] = Field(max_length=10)


class ServiceStatus(BaseModel):
    service: str
    provider: str
    status: str


class VectorPathModel(BaseModel):
    points: list[tuple[float, float]] = Field(min_length=2)
    source_ref: str = Field(min_length=1)


class VectorizeResponse(BaseModel):
    paths: list[VectorPathModel]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
