"""
Module 2 — Goal script generator.
Produces the --goal string passed to CALL-E for round 1 and round 2.
The client MUST review and approve the script before any calls are placed.
"""

ROUND1_TEMPLATE = """You are calling on behalf of a client who is looking to source {product}.
Your goal is to find out whether this business can supply {product} and whether they would be
interested in discussing a potential supply arrangement.

Keep the call brief and professional. Introduce yourself as a sourcing agent.
Ask:
1. Whether they supply or sell {product}.
2. If yes, whether they would be open to a follow-up conversation about quantities and pricing.

If they say yes to both, end the call politely and note that someone will follow up.
If they say no or are not interested, thank them and end the call.
Do not leave a voicemail longer than 20 seconds. Do not argue or persist if they decline."""

ROUND2_TEMPLATE = """You are following up with a business that previously expressed interest in
supplying {product} to a client.

Your goal is to collect the following information — ask for each one clearly, and repeat back
what you heard to confirm:
1. The name and direct contact of the right person to speak with.
2. Whether they can supply {product} and in what approximate quantities.
3. A rough price range per unit or per batch.
4. Their earliest available timeline.

Keep the call under 5 minutes. If they can't answer any item, skip it and move on.
Thank them at the end and let them know someone will be in touch to move forward."""


def generate_goal(product_description: str, round_num: int,
                  persona_name: str = None, persona_tone: str = "professional") -> str:
    template = ROUND1_TEMPLATE if round_num == 1 else ROUND2_TEMPLATE
    goal = template.format(product=product_description).strip()

    persona_prefix = ""
    if persona_name:
        tone_desc = {
            "professional": "professional and courteous",
            "friendly": "warm, friendly and conversational",
            "energetic": "enthusiastic and energetic",
        }.get(persona_tone or "professional", "professional and courteous")
        persona_prefix = (
            f"You are {persona_name}, a procurement specialist. "
            f"Use a {tone_desc} tone throughout the call. "
        )

    return persona_prefix + goal


def prompt_client_approval(goal: str, round_num: int) -> str:
    """
    Shows the generated goal to the user and requires explicit approval or edit.
    Returns the approved (possibly edited) goal string.
    """
    print(f"\n{'='*60}")
    print(f"ROUND {round_num} CALL SCRIPT — REVIEW REQUIRED")
    print(f"{'='*60}")
    print(goal)
    print(f"{'='*60}")
    print("\nOptions:")
    print("  [enter]  Use this script as-is")
    print("  [e]      Edit the script")
    print("  [q]      Quit without calling")

    while True:
        choice = input("\nYour choice: ").strip().lower()
        if choice == "":
            return goal
        elif choice == "e":
            print("\nPaste your edited script below. Enter a blank line when done:")
            lines = []
            while True:
                line = input()
                if line == "" and lines:
                    break
                lines.append(line)
            edited = "\n".join(lines).strip()
            if edited:
                return edited
            print("Empty input — keeping original.")
            return goal
        elif choice == "q":
            raise SystemExit("Aborted by user.")
        else:
            print("Invalid choice.")
