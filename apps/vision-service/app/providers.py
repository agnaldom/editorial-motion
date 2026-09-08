from collections.abc import Protocol

from .schemas import Detection, NormalizedBox, SegmentationMask


class Detector(Protocol):
    """Open-vocabulary detection provider contract."""

    def detect(self, image: bytes, labels: list[str]) -> list[Detection]: ...


class Segmenter(Protocol):
    """Promptable segmentation provider contract."""

    def segment(self, image: bytes, detections: list[Detection]) -> list[SegmentationMask]: ...


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
