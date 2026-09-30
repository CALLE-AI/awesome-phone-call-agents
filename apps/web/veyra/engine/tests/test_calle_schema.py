import pytest

from app.calle_schema import CalleSchemaError, assert_calle_schema_subset


def test_supported_object_schema_passes():
    assert_calle_schema_subset(
        {"type": "object", "properties": {"a": {"type": "string"}}, "additionalProperties": False}
    )


@pytest.mark.parametrize("keyword", ["$ref", "oneOf", "anyOf", "allOf"])
def test_rejected_keywords_raise(keyword):
    with pytest.raises(CalleSchemaError):
        assert_calle_schema_subset({"type": "object", "properties": {}, keyword: {}})


def test_additional_properties_true_raises():
    with pytest.raises(CalleSchemaError):
        assert_calle_schema_subset(
            {"type": "object", "properties": {}, "additionalProperties": True}
        )


def test_array_without_items_raises():
    with pytest.raises(CalleSchemaError):
        assert_calle_schema_subset({"type": "array"})


def test_tuple_items_raises():
    with pytest.raises(CalleSchemaError):
        assert_calle_schema_subset({"type": "array", "items": [{"type": "string"}]})
