import json
from pathlib import Path

import pytest

from app.scene_analysis import analyze_scene

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "v2"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())


def test_todo_caso_tem_imagem_gerada():
    for case in MANIFEST["cases"]:
        assert (FIXTURES / case["source"]).exists(), f"fixture não gerada: {case['source']}"


@pytest.mark.parametrize("case", MANIFEST["cases"], ids=[c["id"] for c in MANIFEST["cases"]])
def test_classificacao_heuristica_bate_com_expectativa(case):
    result = analyze_scene((FIXTURES / case["source"]).read_bytes())
    top = result.classifications[0].type
    assert top in case["expectedTopTypes"], (
        f"{case['id']}: top '{top}' fora de {case['expectedTopTypes']} — got {result.classifications}"
    )


@pytest.mark.parametrize("case", MANIFEST["cases"], ids=[c["id"] for c in MANIFEST["cases"]])
def test_caso_produz_elementos_analisaveis(case):
    result = analyze_scene((FIXTURES / case["source"]).read_bytes())
    assert len(result.elements) >= 1
    assert all(0 <= e.layerability <= 1 for e in result.elements)
