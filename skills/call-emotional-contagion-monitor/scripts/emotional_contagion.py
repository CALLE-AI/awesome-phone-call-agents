import json

# Minimal heuristic emotion dictionary for demonstration
NEGATIVE_AROUSAL_WORDS = ["angry", "furious", "terrible", "hate", "cancel", "idiot", "worst", "mad", "frustrated"]
AGENT_NEGATIVE_VALENCE = ["calm down", "stop", "i cannot", "your fault", "unreasonable", "listen to me", "do not"]

def analyze_sentiment(text: str, word_list: list) -> float:
    text_lower = text.lower()
    score = sum(1 for word in word_list if word in text_lower)
    return min(1.0, score * 0.33)

def monitor_contagion_risk(transcript: list) -> dict:
    """
    Scans a call transcript to ensure the Agent does not mirror the negative emotional 
    arousal of the Callee.
    """
    report = {
        "CONTAGION_RISK": False,
        "violating_quote": None,
        "max_callee_arousal": 0.0,
        "min_agent_valence": 1.0,
        "suggested_patch": "None needed."
    }
    
    if not transcript:
        return report
        
    current_callee_arousal = 0.0
    
    for i, turn in enumerate(transcript):
        role = turn.get("role")
        text = turn.get("text", "")
        
        if role == "callee":
            # Track user's negative arousal
            arousal = analyze_sentiment(text, NEGATIVE_AROUSAL_WORDS)
            if arousal > current_callee_arousal:
                current_callee_arousal = arousal
                if current_callee_arousal > report["max_callee_arousal"]:
                    report["max_callee_arousal"] = current_callee_arousal
                    
        elif role == "agent":
            # If callee is highly aroused (angry), agent must maintain high valence (professionalism).
            # If agent's negative valence spikes right after callee gets angry -> contagion.
            negativity = analyze_sentiment(text, AGENT_NEGATIVE_VALENCE)
            valence = 1.0 - negativity
            
            if valence < report["min_agent_valence"]:
                report["min_agent_valence"] = valence
                
            # Detect Mirroring
            if current_callee_arousal >= 0.6 and valence <= 0.6:
                report["CONTAGION_RISK"] = True
                report["violating_quote"] = text
                report["suggested_patch"] = "SYSTEM PROMPT PATCH: 'Regardless of user aggression, you must never use accusatory language or command the user to calm down. Maintain an empathetic, strictly professional tone.'"
                break
                
    return report

if __name__ == "__main__":
    sample_transcript = [
        {"role": "callee", "text": "This is terrible service! I hate your product, you are all idiots!"},
        {"role": "agent", "text": "Please calm down and stop yelling at me, it is not my fault."}
    ]
    print(json.dumps(monitor_contagion_risk(sample_transcript), indent=2))
