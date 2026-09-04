"""A deliberately small expression language for downstream decision rules.

A call plan declares what the automation *does* with a call result, for example
``confirmed == true``. Rehearsing the plan means evaluating that rule against
many possible results, so the rule has to be evaluated, not executed: the file
is untrusted input and must never be able to run arbitrary Python.

Only the node types listed in ``_ALLOWED_NODES`` survive validation, there is no
attribute access, indexing, comprehension or arbitrary call, and the only
callables in scope are the two helpers defined here.

A field the call did not establish evaluates to ``MISSING`` rather than raising.
``MISSING`` is falsy and compares equal to nothing, which is exactly how
``result.get("confirmed") == True`` behaves in real automation code. Modelling
that faithfully is the point: it is what makes a silently-skipped confirmation
visible.
"""

from __future__ import annotations

import ast


class ExpressionError(ValueError):
    """Raised when a decision expression is not valid or not permitted."""


class _Missing:
    """A field the call never established."""

    _instance = None

    def __new__(cls) -> "_Missing":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __bool__(self) -> bool:
        return False

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Missing)

    def __hash__(self) -> int:
        return hash("<missing>")

    def __repr__(self) -> str:
        return "<missing>"


MISSING = _Missing()

_LITERALS = {"true": True, "false": False, "null": None, "none": None}

_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.And,
    ast.Or,
    ast.UnaryOp,
    ast.Not,
    ast.Compare,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Call,
    ast.List,
    ast.Tuple,
)

_ALLOWED_CALLS = {"is_missing", "is_present"}


def parse(expression: str) -> ast.Expression:
    """Parse and validate a decision expression."""
    text = expression.strip()
    if not text:
        raise ExpressionError("Decision expression is empty.")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        raise ExpressionError(f"Could not parse decision expression: {exc.msg}") from exc

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ExpressionError(
                f"Decision expressions may not use {type(node).__name__}."
            )
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_CALLS:
                allowed = ", ".join(sorted(_ALLOWED_CALLS))
                raise ExpressionError(f"Only these calls are allowed: {allowed}.")
            if node.keywords:
                raise ExpressionError("Decision expression calls take no keyword arguments.")
    return tree


def referenced_fields(expression: str) -> set[str]:
    """Return the result fields a decision expression reads."""
    tree = parse(expression)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id.lower() not in _LITERALS:
            if node.id not in _ALLOWED_CALLS:
                names.add(node.id)
    return names


def evaluate(expression: str, result: dict[str, object]) -> bool:
    """Evaluate a decision expression against one call result."""
    tree = parse(expression)
    return bool(_eval(tree.body, result))


def _lookup(name: str, result: dict[str, object]) -> object:
    lowered = name.lower()
    if lowered in _LITERALS:
        return _LITERALS[lowered]
    if name in result:
        return result[name]
    return MISSING


def _eval(node: ast.AST, result: dict[str, object]) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return _lookup(node.id, result)
    if isinstance(node, ast.List):
        return [_eval(item, result) for item in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval(item, result) for item in node.elts)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return not _eval(node.operand, result)
    if isinstance(node, ast.BoolOp):
        values = [_eval(value, result) for value in node.values]
        if isinstance(node.op, ast.And):
            for value in values:
                if not value:
                    return False
            return True
        for value in values:
            if value:
                return True
        return False
    if isinstance(node, ast.Compare):
        return _eval_compare(node, result)
    if isinstance(node, ast.Call):
        return _eval_call(node, result)
    raise ExpressionError(f"Unsupported expression element: {type(node).__name__}.")


def _eval_call(node: ast.Call, result: dict[str, object]) -> bool:
    name = node.func.id if isinstance(node.func, ast.Name) else ""
    if len(node.args) != 1 or not isinstance(node.args[0], ast.Name):
        raise ExpressionError(f"{name}() takes exactly one field name.")
    present = node.args[0].id in result and result[node.args[0].id] is not MISSING
    return not present if name == "is_missing" else present


def _eval_compare(node: ast.Compare, result: dict[str, object]) -> bool:
    left = _eval(node.left, result)
    for operator, comparator in zip(node.ops, node.comparators):
        right = _eval(comparator, result)
        if not _compare(left, operator, right):
            return False
        left = right
    return True


def _compare(left: object, operator: ast.cmpop, right: object) -> bool:
    if isinstance(operator, ast.Eq):
        return _equal(left, right)
    if isinstance(operator, ast.NotEq):
        return not _equal(left, right)
    if isinstance(operator, ast.In):
        return _contains(right, left)
    if isinstance(operator, ast.NotIn):
        return not _contains(right, left)
    if left is MISSING or right is MISSING:
        return False
    try:
        if isinstance(operator, ast.Lt):
            return left < right          # type: ignore[operator]
        if isinstance(operator, ast.LtE):
            return left <= right         # type: ignore[operator]
        if isinstance(operator, ast.Gt):
            return left > right          # type: ignore[operator]
        if isinstance(operator, ast.GtE):
            return left >= right         # type: ignore[operator]
    except TypeError:
        return False
    raise ExpressionError(f"Unsupported comparison: {type(operator).__name__}.")


def _equal(left: object, right: object) -> bool:
    if left is MISSING or right is MISSING:
        return isinstance(left, _Missing) and isinstance(right, _Missing)
    if isinstance(left, bool) or isinstance(right, bool):
        if isinstance(left, bool) and isinstance(right, bool):
            return left is right
        return False
    return bool(left == right)


def _contains(container: object, value: object) -> bool:
    if container is MISSING or value is MISSING:
        return False
    try:
        return value in container    # type: ignore[operator]
    except TypeError:
        return False
