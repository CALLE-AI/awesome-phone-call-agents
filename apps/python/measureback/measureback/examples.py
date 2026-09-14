"""Authored example conversations, deliberately not real phone recordings."""
from copy import deepcopy

STAGES = ("unresolved", "clarified", "corrected")


def example(stage="corrected"):
    if stage not in STAGES:
        raise ValueError("Choose unresolved, clarified or corrected.")
    turns = [
        {"turn_id": "t1", "speaker": "agent", "text": "This is MeasureBack, an AI assistant. May I write down your cumin rice recipe and share it with your family?"},
        {"turn_id": "t2", "speaker": "cook", "text": "Yes, you can write it down and share it. This makes four servings. Use two bowls of rice, 1000 ml of water, one teaspoon of cumin, one tablespoon of oil, one cinnamon stick and salt to taste."},
        {"turn_id": "t3", "speaker": "cook", "text": "Rinse the rice first. Heat the oil and toast the cumin and cinnamon. Then add the rice and water, cover and simmer for 18 minutes. Let it rest for 5 minutes."},
    ]
    def ev(quote, turn="t2"):
        return {"turn_id": turn, "quote": quote}
    recipe = {
        "title": "Cumin rice", "servings": 4,
        "servings_evidence": ev("This makes four servings."),
        "transcript": turns,
        "ingredients": [
            {"id": "rice", "name": "Rice", "quantity": "2", "unit": "bowl", "evidence": ev("two bowls of rice")},
            {"id": "water", "name": "Water", "quantity": "1000", "unit": "ml", "evidence": ev("1000 ml of water")},
            {"id": "cumin", "name": "Cumin seeds", "quantity": "1", "unit": "tsp", "evidence": ev("one teaspoon of cumin")},
            {"id": "oil", "name": "Oil", "quantity": "1", "unit": "tbsp", "evidence": ev("one tablespoon of oil")},
            {"id": "cinnamon", "name": "Cinnamon stick", "quantity": "1", "unit": "piece", "evidence": ev("one cinnamon stick")},
            {"id": "salt", "name": "Salt", "quantity": None, "unit": "to_taste", "evidence": ev("salt to taste")},
        ],
        "steps": [
            {"id": "rinse", "text": "Rinse the rice.", "duration_minutes": None, "depends_on": [], "evidence": ev("Rinse the rice first.", "t3")},
            {"id": "toast", "text": "Heat the oil. Toast the cumin and cinnamon.", "duration_minutes": None, "depends_on": [], "evidence": ev("Heat the oil and toast the cumin and cinnamon.", "t3")},
            {"id": "simmer", "text": "Add the rice and water, cover and simmer.", "duration_minutes": "18", "depends_on": ["rinse", "toast"], "evidence": ev("Then add the rice and water, cover and simmer for 18 minutes.", "t3")},
            {"id": "rest", "text": "Let the rice rest.", "duration_minutes": "5", "depends_on": ["simmer"], "evidence": ev("Let it rest for 5 minutes.", "t3")},
        ],
        "corrections": [],
    }
    if stage != "unresolved":
        turns.extend([
            {"turn_id": "t4", "speaker": "agent", "text": "Bowls vary in size. How much does your bowl hold at the level you use? Please use a measured amount, not an estimate."},
            {"turn_id": "t5", "speaker": "cook", "text": "I checked with a measuring jug. One level bowl holds 250 ml. I use the same level for rice."},
        ])
        recipe["ingredients"][0]["calibration"] = {"quantity": "250", "unit": "ml", "evidence": ev("One level bowl holds 250 ml. I use the same level for rice.", "t5")}
    if stage == "corrected":
        turns.extend([
            {"turn_id": "t6", "speaker": "agent", "text": "I have two level bowls of rice and 1000 ml of water for four servings. Is that right?"},
            {"turn_id": "t7", "speaker": "cook", "text": "Actually, use 900 ml of water, not 1000 ml. Everything else is right."},
            {"turn_id": "t8", "speaker": "agent", "text": "Corrected to 900 ml of water. The simmer stays 18 minutes and the rest stays 5 minutes. May I share the recipe with those corrections?"},
            {"turn_id": "t9", "speaker": "cook", "text": "Yes, share that corrected recipe."},
        ])
        recipe["ingredients"][1].update(quantity="900", evidence=ev("Actually, use 900 ml of water, not 1000 ml.", "t7"))
        recipe["corrections"] = [{"ingredient_id": "water", "field": "quantity", "previous": "1000", "updated": "900", "evidence": ev("Actually, use 900 ml of water, not 1000 ml.", "t7")}]
    return deepcopy(recipe)
