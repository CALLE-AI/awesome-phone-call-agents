"""Validate source-linked recipes and scale quantities without invented conversions.

The validator checks structure and exact quote provenance. It cannot prove that a
speaker's statement is true or that a language model extracted its meaning correctly.
Quantity arithmetic is deterministic; transcript text is never executed.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from fractions import Fraction
import re
from typing import Any


class RecipeValidationError(ValueError):
    """The recipe is structurally invalid or its source references cannot resolve."""


UNITS = frozenset({"g", "kg", "ml", "l", "tsp", "tbsp", "cup", "piece", "bowl", "to_taste"})
CALIBRATION_UNITS = frozenset({"g", "kg", "ml", "l"})
HOUSEHOLD_UNITS = frozenset({"cup", "bowl"})
MAX_QUANTITY = Decimal("1000000")
MAX_DURATION = Decimal("10080")
MAX_SERVINGS = 1000
_DECIMAL = re.compile(r"(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?\Z")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")


def _fail(path: str, message: str) -> None:
    raise RecipeValidationError(f"{path}: {message}")


def _object(value: Any, path: str, required: set[str], optional: set[str] | None = None) -> dict:
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    keys = set(value)
    if not required.issubset(keys):
        _fail(path, f"missing fields: {', '.join(sorted(required - keys))}")
    unknown = keys - required - (optional or set())
    if unknown:
        _fail(path, "contains unsupported fields")
    return value


def _text(value: Any, path: str, limit: int = 4000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        _fail(path, f"must be a nonempty string of at most {limit} characters")
    if any(ord(char) < 32 and char not in "\n\t\r" for char in value):
        _fail(path, "contains unsupported control characters")
    return value


def _identifier(value: Any, path: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        _fail(path, "must be a 1 to 64 character alphanumeric identifier")
    return value


def _array(value: Any, path: str, maximum: int, *, empty: bool = True) -> list:
    if not isinstance(value, list) or len(value) > maximum or (not empty and not value):
        _fail(path, f"must be {'a nonempty' if not empty else 'an'} array with at most {maximum} entries")
    return value


def _number(value: Any, path: str, *, maximum: Decimal = MAX_QUANTITY, zero: bool = False) -> Decimal:
    # Restrict grammar before Decimal construction to reject exponents, infinities,
    # booleans, whitespace and unbounded digit strings at the input boundary.
    if not isinstance(value, str) or not _DECIMAL.fullmatch(value):
        _fail(path, "must be a plain decimal string with at most 6 decimal places")
    try:
        number = Decimal(value)
    except InvalidOperation:
        _fail(path, "is not a valid decimal")
    if not number.is_finite() or number > maximum or number < 0 or (not zero and number == 0):
        _fail(path, f"must be {'at least zero' if zero else 'positive'} and no greater than {maximum}")
    return number


def _servings(value: Any, path: str) -> int:
    if type(value) is not int or not 1 <= value <= MAX_SERVINGS:
        _fail(path, f"must be an integer from 1 to {MAX_SERVINGS}")
    return value


def _unit(value: Any, path: str) -> str:
    if not isinstance(value, str) or value not in UNITS:
        _fail(path, "must be a supported unit")
    return value


def _evidence(value: Any, path: str, turns: dict[str, dict]) -> None:
    obj = _object(value, path, {"turn_id", "quote"})
    turn_id = _identifier(obj["turn_id"], f"{path}.turn_id")
    quote = _text(obj["quote"], f"{path}.quote")
    if turn_id not in turns:
        _fail(path, "references a missing transcript turn")
    turn = turns[turn_id]
    if turn["speaker"] != "cook":
        _fail(path, "must cite the cook, not the assistant")
    if quote not in turn["text"]:
        _fail(path, "quote is not an exact substring of the cited turn")


def validate_recipe(recipe: Any) -> dict:
    """Return an independent validated copy or raise RecipeValidationError.

    Ingredient quantities and step durations are decimal strings, or null when
    unknown. A household calibration describes ONE unit of THIS ingredient.
    Cups intentionally have no implicit volume. Corrections are explicit source
    records, not a history inferred from the current ingredients.
    """
    root = _object(recipe, "recipe", {"title", "servings", "transcript", "ingredients", "steps", "corrections"}, {"servings_evidence"})
    _text(root["title"], "title", 200)
    _servings(root["servings"], "servings")
    turns: dict[str, dict] = {}
    for index, turn in enumerate(_array(root["transcript"], "transcript", 500, empty=False)):
        path = f"transcript[{index}]"
        _object(turn, path, {"turn_id", "speaker", "text"})
        turn_id = _identifier(turn["turn_id"], f"{path}.turn_id")
        if turn_id in turns:
            _fail(path, "duplicate turn_id")
        if turn["speaker"] not in ("cook", "agent"):
            _fail(f"{path}.speaker", "must be cook or agent")
        _text(turn["text"], f"{path}.text")
        turns[turn_id] = turn
    if "servings_evidence" in root:
        _evidence(root["servings_evidence"], "servings_evidence", turns)

    ingredients: dict[str, dict] = {}
    for index, ingredient in enumerate(_array(root["ingredients"], "ingredients", 100, empty=False)):
        path = f"ingredients[{index}]"
        _object(ingredient, path, {"id", "name", "quantity", "unit", "evidence"}, {"calibration"})
        ingredient_id = _identifier(ingredient["id"], f"{path}.id")
        if ingredient_id in ingredients:
            _fail(path, "duplicate ingredient id")
        _text(ingredient["name"], f"{path}.name", 200)
        unit = _unit(ingredient["unit"], f"{path}.unit")
        quantity = ingredient["quantity"]
        if quantity is not None:
            _number(quantity, f"{path}.quantity")
        if unit == "to_taste" and quantity is not None:
            _fail(path, "to_taste requires a null quantity")
        _evidence(ingredient["evidence"], f"{path}.evidence", turns)
        if "calibration" in ingredient:
            if unit not in HOUSEHOLD_UNITS:
                _fail(path, "only bowl and cup support household calibration")
            calibration = _object(ingredient["calibration"], f"{path}.calibration", {"quantity", "unit", "evidence"})
            _number(calibration["quantity"], f"{path}.calibration.quantity")
            if not isinstance(calibration["unit"], str) or calibration["unit"] not in CALIBRATION_UNITS:
                _fail(f"{path}.calibration.unit", "must be g, kg, ml or l")
            _evidence(calibration["evidence"], f"{path}.calibration.evidence", turns)
        ingredients[ingredient_id] = ingredient

    steps: dict[str, dict] = {}
    for index, step in enumerate(_array(root["steps"], "steps", 200, empty=False)):
        path = f"steps[{index}]"
        _object(step, path, {"id", "text", "duration_minutes", "depends_on", "evidence"})
        step_id = _identifier(step["id"], f"{path}.id")
        if step_id in steps:
            _fail(path, "duplicate step id")
        _text(step["text"], f"{path}.text", 2000)
        if step["duration_minutes"] is not None:
            _number(step["duration_minutes"], f"{path}.duration_minutes", maximum=MAX_DURATION, zero=True)
        dependencies = _array(step["depends_on"], f"{path}.depends_on", 200)
        seen: set[str] = set()
        for dependency in dependencies:
            _identifier(dependency, f"{path}.depends_on")
            if dependency == step_id or dependency in seen:
                _fail(path, "dependencies must be unique and cannot include the step itself")
            seen.add(dependency)
        _evidence(step["evidence"], f"{path}.evidence", turns)
        steps[step_id] = step
    for step_id, step in steps.items():
        if any(dependency not in steps for dependency in step["depends_on"]):
            _fail(f"steps.{step_id}", "references a missing dependency")
    # Kahn's algorithm also accepts dependencies listed later in the recipe.
    resolved: set[str] = set()
    while len(resolved) < len(steps):
        ready = {step_id for step_id, step in steps.items() if step_id not in resolved and set(step["depends_on"]).issubset(resolved)}
        if not ready:
            _fail("steps", "dependency graph contains a cycle")
        resolved.update(ready)

    last_correction: dict[tuple[str, str], Any] = {}
    correction_turn: dict[tuple[str, str], int] = {}
    turn_order = {turn_id: index for index, turn_id in enumerate(turns)}
    for index, correction in enumerate(_array(root["corrections"], "corrections", 200)):
        path = f"corrections[{index}]"
        _object(correction, path, {"ingredient_id", "field", "previous", "updated", "evidence"})
        ingredient_id = _identifier(correction["ingredient_id"], f"{path}.ingredient_id")
        if ingredient_id not in ingredients:
            _fail(path, "references a missing ingredient")
        field = correction["field"]
        if field not in ("quantity", "unit"):
            _fail(path, "field must be quantity or unit")
        for label in ("previous", "updated"):
            value = correction[label]
            if field == "unit":
                _unit(value, f"{path}.{label}")
            elif value is not None:
                _number(value, f"{path}.{label}")
        if correction["previous"] == correction["updated"]:
            _fail(path, "must describe an actual change")
        _evidence(correction["evidence"], f"{path}.evidence", turns)
        key = (ingredient_id, field)
        if key in last_correction and last_correction[key] != correction["previous"]:
            _fail(path, "does not continue the preceding correction")
        position = turn_order[correction["evidence"]["turn_id"]]
        if position < correction_turn.get(key, -1):
            _fail(path, "correction evidence is out of transcript order")
        correction_turn[key] = position
        last_correction[key] = correction["updated"]
    for (ingredient_id, field), updated in last_correction.items():
        if ingredients[ingredient_id][field] != updated:
            _fail("corrections", f"final {field} correction does not match ingredient {ingredient_id}")
    return deepcopy(root)


def _fraction_output(value: Fraction, unit: str) -> dict:
    with localcontext() as context:
        context.prec = 50
        decimal_value = Decimal(value.numerator) / Decimal(value.denominator)
        rounded = decimal_value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        # Do not display a positive but tiny quantity as zero.
        if rounded == 0 and value > 0:
            quantity = format(decimal_value, ".12g")
        else:
            quantity = format(rounded, "f").rstrip("0").rstrip(".") if "." in format(rounded, "f") else format(rounded, "f")
        approximate = Fraction(Decimal(quantity)) != value
    return {"quantity": quantity, "unit": unit, "approximate": approximate, "exact_fraction": f"{value.numerator}/{value.denominator}"}


def scale_recipe(recipe: Any, target_servings: int) -> dict:
    """Scale only known ingredient quantities, preserving steps and source evidence.

    Status is scaled, unresolved, to_taste or needs_review. Fractional pieces are
    never rounded to whole items. Timings and instructions are copied unchanged:
    scaling a batch does not establish a new cooking time or appliance capacity.
    """
    root = validate_recipe(recipe)
    _servings(target_servings, "target_servings")
    factor = Fraction(target_servings, root["servings"])
    output: list[dict] = []
    questions: list[dict] = []
    for ingredient in root["ingredients"]:
        unit = ingredient["unit"]
        item = {
            "id": ingredient["id"],
            "name": ingredient["name"],
            "original": {"quantity": ingredient["quantity"], "unit": unit},
            "scaled": None,
            "status": "scaled",
            "evidence": deepcopy(ingredient["evidence"]),
            "reason": "Quantity scaled from the recorded amount; no cooking-time inference.",
        }
        if unit == "to_taste":
            item.update(status="to_taste", reason="To taste stays to taste; no numeric amount is invented.")
        elif ingredient["quantity"] is None:
            item.update(status="unresolved", reason="The source quantity is unknown.")
            questions.append({"ingredient_id": ingredient["id"], "kind": "quantity", "question": f"What quantity of {ingredient['name']} is used for {root['servings']} servings?"})
        elif unit in HOUSEHOLD_UNITS and "calibration" not in ingredient:
            item.update(status="unresolved", reason=f"A {unit} has no assumed standard size. An ingredient-specific measurement is needed.")
            questions.append({"ingredient_id": ingredient["id"], "kind": "calibration", "question": f"For {ingredient['name']}, how many grams or millilitres does one {unit} hold at the fill level used?"})
        else:
            quantity = Fraction(Decimal(ingredient["quantity"])) * factor
            if unit in HOUSEHOLD_UNITS:
                calibration = ingredient["calibration"]
                quantity *= Fraction(Decimal(calibration["quantity"]))
                unit = calibration["unit"]
                item["calibration"] = deepcopy(calibration)
                item["reason"] = "Scaled using this ingredient's explicitly recorded household measurement. No density conversion."
            item["scaled"] = _fraction_output(quantity, unit)
            if unit == "piece" and quantity.denominator != 1:
                item.update(status="needs_review", reason="Scaling produces a fractional item. Decide how to divide it; no whole-item rounding was applied.")
                questions.append({"ingredient_id": ingredient["id"], "kind": "fractional_piece", "question": f"How should {item['scaled']['quantity']} pieces of {ingredient['name']} be portioned?"})
            elif item["scaled"]["approximate"]:
                item["reason"] += " Display is approximate; the exact fraction is retained."
        output.append(item)
    return {
        "title": root["title"],
        "source_servings": root["servings"],
        "target_servings": target_servings,
        "scale_factor": _fraction_output(factor, "ratio"),
        "ingredients": output,
        "steps": deepcopy(root["steps"]),
        "unresolved_questions": questions,
        "corrections": deepcopy(root["corrections"]),
        "review_required": bool(questions),
        "timing_note": "Original cooking times are unchanged, not validated for the larger or smaller batch. Confirm doneness, equipment capacity and safe handling with the cook.",
        "evidence_note": "Quotes are checked against the supplied transcript; their truth and the extraction's meaning still need human review.",
    }
