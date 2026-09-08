import pytest
from pydantic import ValidationError

from app.schemas import Detection, DetectionRequest, NormalizedBox


def test_normalized_box_accepts_valid_coordinates() -> None:
    box = NormalizedBox(x=0, y=0.1, width=0.5, height=0.4)
    assert box.width == 0.5


def test_normalized_box_rejects_out_of_range_coordinates() -> None:
    with pytest.raises(ValidationError):
        NormalizedBox(x=1.1, y=0, width=0.5, height=0.5)


def test_detection_request_limits_labels() -> None:
    with pytest.raises(ValidationError):
        DetectionRequest(labels=[str(index) for index in range(11)])


def test_detection_requires_confidence_and_bbox() -> None:
    with pytest.raises(ValidationError):
        Detection(label="map")
