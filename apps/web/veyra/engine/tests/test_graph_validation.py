from app.graph_validation import validate_graph
from app.models.workflow import Workflow
from app.sample_workflow import SAMPLE_WORKFLOW


def test_sample_workflow_is_valid():
    result = validate_graph(SAMPLE_WORKFLOW)
    assert result.valid, result.errors
    assert result.warnings == []


def test_missing_start_node_is_an_error():
    data = SAMPLE_WORKFLOW.model_dump(by_alias=True)
    data["nodes"][0]["type"] = "question"
    workflow = Workflow.model_validate(data)
    result = validate_graph(workflow)
    assert not result.valid
    assert any("no start node" in e for e in result.errors)


def test_dangling_edge_is_an_error():
    data = SAMPLE_WORKFLOW.model_dump(by_alias=True)
    data["edges"][0]["to"] = "does-not-exist"
    workflow = Workflow.model_validate(data)
    result = validate_graph(workflow)
    assert not result.valid
    assert any("unknown to-node" in e for e in result.errors)


def test_unreachable_node_is_an_error():
    data = SAMPLE_WORKFLOW.model_dump(by_alias=True)
    data["nodes"].append(
        {
            "id": "orphan",
            "type": "terminal",
            "label": "Orphan",
            "say": "unreachable",
            "captures": [],
            "x": 0,
            "y": 0,
        }
    )
    workflow = Workflow.model_validate(data)
    result = validate_graph(workflow)
    assert not result.valid
    assert any("Unreachable" in e and "orphan" in e for e in result.errors)


def test_qualification_field_not_captured_is_a_warning():
    data = SAMPLE_WORKFLOW.model_dump(by_alias=True)
    data["qualification"]["rules"][0]["field"] = "never_captured"
    workflow = Workflow.model_validate(data)
    result = validate_graph(workflow)
    assert result.valid
    assert any("never_captured" in w for w in result.warnings)
