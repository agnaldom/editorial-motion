import pytest

from app.inpainting import DevelopmentInpainter, create_inpainter
from app.providers import (
    DevelopmentDetector,
    DevelopmentSegmenter,
    GroundingDinoDetector,
    Sam2Segmenter,
    create_detector,
    create_segmenter,
    create_vectorizer,
)
from app.routes import SkeletonRouteVectorizer


def test_factories_default_to_safe_development_providers(monkeypatch):
    monkeypatch.delenv("DETECTOR_PROVIDER", raising=False)
    monkeypatch.delenv("SEGMENTER_PROVIDER", raising=False)
    monkeypatch.delenv("INPAINT_PROVIDER", raising=False)
    monkeypatch.delenv("VECTORIZER_PROVIDER", raising=False)
    assert isinstance(create_detector(), DevelopmentDetector)
    assert isinstance(create_segmenter(), DevelopmentSegmenter)
    assert isinstance(create_inpainter(), DevelopmentInpainter)
    assert isinstance(create_vectorizer(), SkeletonRouteVectorizer)


def test_factories_reject_unknown_providers(monkeypatch):
    monkeypatch.setenv("DETECTOR_PROVIDER", "yolo")
    with pytest.raises(ValueError, match="Unknown DETECTOR_PROVIDER"):
        create_detector()
    monkeypatch.setenv("SEGMENTER_PROVIDER", "yolo")
    with pytest.raises(ValueError, match="Unknown SEGMENTER_PROVIDER"):
        create_segmenter()
    monkeypatch.setenv("INPAINT_PROVIDER", "yolo")
    with pytest.raises(ValueError, match="Unknown INPAINT_PROVIDER"):
        create_inpainter()
    monkeypatch.setenv("VECTORIZER_PROVIDER", "yolo")
    with pytest.raises(ValueError, match="Unknown VECTORIZER_PROVIDER"):
        create_vectorizer()


def test_ml_providers_fail_with_actionable_error_when_extras_missing(monkeypatch):
    monkeypatch.setenv("DETECTOR_PROVIDER", "groundingdino")
    monkeypatch.setenv("SEGMENTER_PROVIDER", "sam2")
    monkeypatch.setenv("INPAINT_PROVIDER", "lama")
    with pytest.raises(ImportError, match="requirements-ml.txt"):
        create_detector()
    with pytest.raises(ImportError, match="requirements-ml.txt"):
        create_segmenter()
    with pytest.raises(ImportError, match="requirements-ml.txt"):
        create_inpainter()


def test_ml_provider_classes_expose_names():
    assert GroundingDinoDetector.name == "groundingdino"
    assert Sam2Segmenter.name == "sam2"
