import importlib.util


def load_evaluator_module():
    """
    Load evaluator.py directly so the test does not require
    the skill directory to be installed as a Python package.
    """

    spec = importlib.util.spec_from_file_location(
        "evaluator",
        "skills/learning-recall-call/scripts/evaluator.py",
    )

    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load evaluator.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def run_test():
    evaluator_module = load_evaluator_module()

    evaluator = evaluator_module.DeterministicRecallEvaluator()

    topic = "Hashing vs Encryption"

    study_context = """
    Hashing is generally a one-way transformation used to produce
    a fixed-length digest. Encryption is designed to allow data to
    be recovered using the appropriate key.
    """

    learner_response = (
        "Hashing encrypts the password so that we can decrypt it later."
    )

    # Run the learner response through the evaluator.
    result = evaluator.evaluate(
        topic=topic,
        study_context=study_context,
        learner_response=learner_response,
    )

    # Validate the structured assessment.
    evaluator_module.validate_assessment(result)

    # Display the assessment.
    print(evaluator_module.format_assessment(result))

    # Verify the expected behavior.
    assert result["topic"] == topic
    assert result["status"] == "misconception_detected"
    assert result["recall_score"] == 55
    assert len(result["misconceptions"]) == 1
    assert result["misconceptions"][0]["concept"] == (
        "Hashing vs encryption"
    )
    assert "Hashing vs encryption" in result["weak_areas"]

    print("\nEVALUATOR INTEGRATION TEST PASSED")


if __name__ == "__main__":
    run_test()