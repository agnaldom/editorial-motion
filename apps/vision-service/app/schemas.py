from pydantic import BaseModel, Field
from typing import Literal


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


class SceneElementModel(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    type: Literal['cutout', 'map_region', 'route', 'arrow', 'icon', 'photo', 'document', 'chart', 'text', 'stat_box', 'background', 'decorative']
    bbox: NormalizedBox
    confidence: float = Field(ge=0, le=1)
    zIndex: int = Field(ge=1)
    animatable: bool
    protected: bool
    motionRole: Literal['primary', 'secondary', 'connector', 'static', 'protected']
    source: Literal['vision', 'detector', 'derived']
    layerability: float = Field(default=0, ge=0, le=1)


class ProtectedRegionModel(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    bbox: NormalizedBox
    reason: str = Field(min_length=1)


class SourceDimensions(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    aspectRatio: float = Field(gt=0)


class SceneClassificationModel(BaseModel):
    """SPEC V2 §10 — classificação multi-rótulo com confiança (issue #142)."""
    type: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class SceneAnalysisResponse(BaseModel):
    """Contrato espelhado no zod scene-schema da API (packages/scene-schema)."""
    version: Literal['1']
    sceneId: str = Field(min_length=1)
    source: SourceDimensions
    compositionType: Literal['editorial-collage', 'map', 'diagram', 'infographic', 'photo', 'mixed']
    classifications: list[SceneClassificationModel] = Field(default_factory=list)
    elements: list[SceneElementModel] = Field(max_length=10)
    protectedRegions: list[ProtectedRegionModel]
