import os
import re
from typing import Protocol
from io import BytesIO
from pathlib import Path

from PIL import Image

from .schemas import Detection, NormalizedBox, SegmentationMask
from .routes import SkeletonRouteVectorizer, VectorPath


class Detector(Protocol):
    """Open-vocabulary detection provider contract."""

    def detect(self, image: bytes, labels: list[str]) -> list[Detection]: ...


class Segmenter(Protocol):
    """Promptable segmentation provider contract."""

    def segment(self, image: bytes, detections: list[Detection]) -> list[SegmentationMask]: ...


class RouteVectorizer(Protocol):
    """Route mask vectorization provider contract (SPEC §21.4)."""

    def vectorize(self, route_mask: Image.Image) -> list[VectorPath]: ...


class DevelopmentDetector:
    """Safe local provider used until a Grounding DINO adapter is configured."""

    name = "development-null"

    def detect(self, image: bytes, labels: list[str]) -> list[Detection]:
        if not image:
            raise ValueError("image is empty")
        # Never invent detections. A real provider must be explicitly configured.
        return []


class DevelopmentSegmenter:
    """Safe local provider used until a SAM 2 adapter is configured."""

    name = "development-null"

    def segment(self, image: bytes, detections: list[Detection]) -> list[SegmentationMask]:
        if not image:
            raise ValueError("image is empty")
        return []


ML_EXTRAS_HINT = "ML extras are required: pip install -r requirements-ml.txt"


class GroundingDinoDetector:
    """Grounding DINO via transformers (zero-shot object detection)."""

    name = "groundingdino"

    def __init__(self, model_id: str | None = None, device: str | None = None):
        try:
            import torch
            from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        except ImportError as error:
            raise ImportError(f"GroundingDINO provider could not import torch/transformers. {ML_EXTRAS_HINT}") from error
        self._torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        model_id = model_id or os.environ.get("GROUNDING_DINO_MODEL", "IDEA-Research/grounding-dino-tiny")
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(self.device)

    def detect(self, image: bytes, labels: list[str]) -> list[Detection]:
        if not image:
            raise ValueError("image is empty")
        pil = Image.open(BytesIO(image)).convert("RGB")
        text = ". ".join(f"a {label}" for label in labels) + "."
        inputs = self.processor(images=pil, text=text, return_tensors="pt").to(self.device)
        with self._torch.no_grad():
            outputs = self.model(**inputs)
        results = self.processor.post_process_grounded_object_detection(
            outputs,
            inputs["input_ids"],
            threshold=0.3,
            text_threshold=0.3,
            target_sizes=[pil.size[::-1]],
        )[0]
        width, height = pil.size
        detections = [
            Detection(
                label=label,
                confidence=min(1.0, max(0.0, float(score))),
                bbox=NormalizedBox(
                    x=min(1.0, max(0.0, x1 / width)),
                    y=min(1.0, max(0.0, y1 / height)),
                    width=min(1.0, max(0.0, (x2 - x1) / width)),
                    height=min(1.0, max(0.0, (y2 - y1) / height)),
                ),
            )
            for label, score, (x1, y1, x2, y2) in zip(results["labels"], results["scores"], results["boxes"].tolist())
        ]
        return detections[:10]


def _slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "element"


class Sam2Segmenter:
    """SAM 2 (sam2 package) box-prompted segmentation."""

    name = "sam2"

    def __init__(self, model_id: str | None = None, device: str | None = None, mask_dir: str | Path | None = None):
        try:
            import torch
            from sam2.sam2_image_predictor import SAM2ImagePredictor
        except ImportError as error:
            raise ImportError(f"SAM 2 provider could not import torch/sam2. {ML_EXTRAS_HINT}") from error
        self._torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        model_id = model_id or os.environ.get("SAM2_MODEL", "facebook/sam2.1-hiera-tiny")
        self.predictor = SAM2ImagePredictor.from_pretrained(model_id, device=self.device)
        self.mask_dir = Path(mask_dir or os.environ.get("VISION_MASK_DIR", "./data/masks"))

    def segment(self, image: bytes, detections: list[Detection]) -> list[SegmentationMask]:
        if not image:
            raise ValueError("image is empty")
        import numpy as np

        pil = Image.open(BytesIO(image)).convert("RGB")
        width, height = pil.size
        self.predictor.set_image(np.asarray(pil))
        self.mask_dir.mkdir(parents=True, exist_ok=True)
        masks: list[SegmentationMask] = []
        for index, detection in enumerate(detections):
            box = np.array([
                detection.bbox.x * width,
                detection.bbox.y * height,
                (detection.bbox.x + detection.bbox.width) * width,
                (detection.bbox.y + detection.bbox.height) * height,
            ])
            results, scores, _ = self.predictor.predict(box=box[None, :], multimask_output=False)
            mask_ref = self.mask_dir / f"{index:02d}-{_slug(detection.label)}.png"
            Image.fromarray((results[0] * 255).astype("uint8"), mode="L").save(mask_ref)
            masks.append(SegmentationMask(
                label=detection.label,
                confidence=min(1.0, max(0.0, float(scores[0]))),
                width=width,
                height=height,
                mask_ref=str(mask_ref),
            ))
        return masks


def create_detector() -> Detector:
    provider = os.environ.get("DETECTOR_PROVIDER", "none").strip().lower()
    if provider == "groundingdino":
        return GroundingDinoDetector()
    if provider in ("", "none", "development"):
        return DevelopmentDetector()
    raise ValueError(f"Unknown DETECTOR_PROVIDER: {provider}")


def create_segmenter() -> Segmenter:
    provider = os.environ.get("SEGMENTER_PROVIDER", "none").strip().lower()
    if provider == "sam2":
        return Sam2Segmenter()
    if provider in ("", "none", "development"):
        return DevelopmentSegmenter()
    raise ValueError(f"Unknown SEGMENTER_PROVIDER: {provider}")


def create_vectorizer() -> RouteVectorizer:
    provider = os.environ.get("VECTORIZER_PROVIDER", "skeleton").strip().lower()
    if provider in ("", "skeleton", "default"):
        return SkeletonRouteVectorizer()
    raise ValueError(f"Unknown VECTORIZER_PROVIDER: {provider}")
