"""What the agent says, and the shape of the answer it must bring back.

Two things live here, and they are the whole product:

  `build_task()`      the prose CALL-E speaks. Disclosure, one question, and the
                      handling for the three things that actually happen on a
                      pharmacy line: a phone tree, a hold, and a transfer.
  `RECIPIENT_SCHEMA`  the JSON Schema the answer is validated against.

Two rules govern the question, and both are about staying inside the boundary the
repository sets for medical content. Sticker asks a *retail price* question, the same
one a walk-in customer asks a hundred times a day. It never mentions a patient, never
names a person, never asks for or supplies a prescription number, and never asks for
clinical advice. The drug is named the way a price list names it, not the way a chart
does.
"""

from __future__ import annotations

from dataclasses import dataclass

# CALL-E accepts a narrow subset of JSON Schema. No $ref, no oneOf/anyOf/allOf, no
# recursion, and no union types such as ["string", "null"]: those come back as
# result_schema_invalid. Optionality is therefore expressed with a literal "unknown"
# member rather than a nullable type, which is also the house style across this repo.
#
# `summary`, `status`, `transcript`, `call_id` and timing fields are reserved by the
# platform inside a recipient schema and are rejected, so the free-text field is `notes`.
RECIPIENT_SCHEMA: dict = {
    "type": "object",
    "required": ["answered_by", "quote_status", "cash_price_usd", "quantity_quoted", "notes"],
    "properties": {
        "answered_by": {
            "type": "string",
            "enum": ["human", "ivr", "voicemail", "unknown"],
            "description": (
                "Classify the final endpoint of the call. If an automated menu transferred "
                "the call to a person, use human. Use ivr only if the call ended while still "
                "inside an automated system."
            ),
        },
        "quote_status": {
            "type": "string",
            "enum": ["quoted", "refused", "not_stocked", "unknown"],
            "description": (
                "Use quoted only when a specific dollar amount for the requested quantity was "
                "actually said aloud. Use refused when staff declined to give a price by phone, "
                "including when they required a prescription on file first. Use not_stocked when "
                "they do not carry the drug at all. Use unknown in every other case."
            ),
        },
        "cash_price_usd": {
            "type": "string",
            "description": (
                "The cash price in US dollars for the requested quantity, digits only, for "
                "example 42.99. Use unknown if no specific amount was stated. Never estimate, "
                "convert, or average. If a range was given, record the lowest number stated."
            ),
        },
        "quantity_quoted": {
            "type": "string",
            "description": (
                "The number of tablets, capsules, or millilitres the quoted price covers, as "
                "stated by the pharmacy. Use unknown if they did not say. This may differ from "
                "the quantity asked for."
            ),
        },
        "requires_prescription_on_file": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did staff say they could only price this once a prescription was on file at "
                "their pharmacy?"
            ),
        },
        "is_generic": {
            "type": "string",
            "enum": ["generic", "brand", "unknown"],
            "description": "Whether the price quoted was for the generic or the brand product.",
        },
        "discount_program_mentioned": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Did staff volunteer a membership, savings club, or discount card price rather "
                "than the plain cash price?"
            ),
        },
        "notes": {
            "type": "string",
            "description": (
                "One short sentence in the staff member's own words describing the price or the "
                "refusal. No names, no personal details."
            ),
        },
    },
    "additionalProperties": False,
}


@dataclass(frozen=True)
class DrugRequest:
    """A drug as a price list names it, not as a chart does."""

    name: str  # "metformin"
    strength: str  # "500 mg"
    form: str  # "tablet"
    quantity: int  # 30

    def spoken(self) -> str:
        """How a person says this at a counter, which is not how a database spells it.

        Read aloud, "metformin hcl 500 mg tablets" becomes "metformin H C L five hundred
        M G tablets", which is four seconds of noise a pharmacist has to decode before
        they know what is being asked. The salt form and the abbreviation are there for
        the federal price file, not for the phone, so both are dropped here. `name` and
        `strength` are unchanged for `nadac_prefix`.
        """
        name = self.name
        for salt in (
            " hcl",
            " hydrochloride",
            " sodium",
            " potassium",
            " calcium",
            " succinate",
            " tartrate",
            " besylate",
        ):
            if name.lower().endswith(salt):
                name = name[: -len(salt)]
                break
        strength = self.strength.replace(" mg", " milligram").replace(" mcg", " microgram")
        return f"{name} {strength} {self.form}s"

    def nadac_prefix(self) -> str:
        """How CMS spells this in `ndc_description`, e.g. "METFORMIN HCL 500 MG"."""
        return f"{self.name} {self.strength}".upper()

    def slug(self) -> str:
        return "-".join(
            part
            for part in f"{self.name}-{self.strength}-{self.form}-{self.quantity}".lower().split()
        ).replace("--", "-")


def build_task(drug: DrugRequest, *, caller_org: str) -> str:
    """The instruction CALL-E performs.

    Everything real-world about a pharmacy call is steered from this prose, because the
    API exposes no parameter for any of it: there is no DTMF setting, no hold policy, no
    voicemail flag and no transfer target. The phone tree, the hold and the handoff to
    the pharmacist are handled here or not at all.

    The disclosure is first and unconditional. CALL-E does not announce itself, and the
    platform's terms put that duty on the caller, so it is written into the first
    sentence and asserted in the test suite.
    """
    # Every second this takes to say is a second a busy counter can decide to hang up, so
    # it is written to be short and to sound like a person: a contraction, the drug before
    # the caveat, and the whole thing in one breath.
    question = f"What's your cash price for {drug.quantity} {drug.spoken()}, no insurance?"
    return (
        f"You are calling the counter of a retail pharmacy on behalf of {caller_org}. You "
        "want one number and nothing else, and the person answering is busy.\n"
        "\n"
        "YOUR FIRST WORD IS ONLY THIS: \"Hello?\"\n"
        "\n"
        "Say that one word and nothing else, then go completely silent and listen. The "
        "line usually opens before anyone has spoken, and a pharmacy answers with its own "
        "name, a hold message, or a recorded menu. Anything you say into that is lost, and "
        "the person hears a machine talking across their greeting. One short word survives "
        "a collision. A whole question does not.\n"
        "\n"
        "Stay silent while any greeting, hold message or recording is playing. Wait for it "
        "to finish.\n"
        "\n"
        "WAIT FOR THEM TO FINISH, NOT MERELY TO START. A pharmacy greeting runs longer "
        "than you expect: a name, sometimes a second name, a question, sometimes a whole "
        "sentence about hold times. Hearing the first words of it is not your cue. Wait "
        "until they have stopped speaking and the line has been quiet for about two "
        "seconds. If they are still talking, say nothing, even if you think you know how "
        "the sentence ends. Cutting across a greeting is how this call gets hung up on.\n"
        "\n"
        "ONLY once a live person has finished speaking and the line is quiet, say this as "
        "one short turn, then stop talking:\n"
        f'  "Hi, I\'m an AI assistant doing a price check. {question}"\n'
        "\n"
        "That single sentence both discloses what you are and asks the question, which is "
        "the whole call. Say you are an AI before you ask for anything, every time, "
        "including after a transfer or a handover to a second person. If anyone asks "
        "whether you are a real person, say plainly that you are an AI assistant. If "
        "anyone asks whether the call is recorded, say that it is.\n"
        "\n"
        "If they say hello again, ask who is calling, ask you to repeat yourself, or go "
        "quiet as though they did not hear you, say that same sentence again, once. People "
        "often miss the first few words of a call.\n"
        "\n"
        "Then wait. Give them room to look the price up. Do not fill silence and do not "
        "narrate that you are holding.\n"
        "\n"
        "NEVER HANG UP ON A PERSON. While someone is on the line and has not yet answered, "
        "stay on it, however long the pause runs. Looking a price up means walking to a "
        "terminal. If the silence runs long enough to be strange, ask once, gently: \"Are "
        "you able to check that price for me?\" Only the stop conditions below end a call "
        "early, and none of them is a person thinking.\n"
        "\n"
        "How to handle the call:\n"
        "- If a recorded menu answers, let it finish, then use the keypad to reach the "
        "pharmacy counter or a pharmacist. Do not speak to a menu, and do not press a key "
        "before you have heard the option you want.\n"
        "- If you are put on hold, wait quietly.\n"
        "- If you are transferred, wait for the new person to speak, then say the same "
        "single sentence again.\n"
        "- If they quote a price for a different quantity, accept it and record the quantity "
        "they actually priced. Do not ask them to requote.\n"
        "- If they ask which patient this is for, say there is no patient and no "
        "prescription, and that you only need the shelf price.\n"
        "- Never give a prescription number, a date of birth, a member id, or any personal "
        "detail, and never invent one. You have none.\n"
        "\n"
        "END THE CALL IMMEDIATELY, saying nothing further, if any of these happen. Each one "
        "is a complete and useful answer, and staying on the line only wastes a working "
        "pharmacy's time:\n"
        "- You reach a voicemail box, an answering machine, or an after-hours recording. Do "
        "not leave a message, do not speak to it, do not wait for a person, and do not call "
        "back. Nobody asked us to leave a message.\n"
        "- An automated system requires a prescription number, a patient, a member id, or "
        "any verification you cannot give. You will never get past it, so stop.\n"
        "- The same recorded menu or message repeats a second time.\n"
        "- They decline to give a price by phone. Thank them once and hang up. A refusal is "
        "a useful answer. Do not argue and do not ask twice.\n"
        "\n"
        "Never ask for medical advice, never describe symptoms, and never suggest that anyone "
        "should start, stop, or change a medication.\n"
        "\n"
        "End the call as soon as you have a price, a refusal, or one of the stop "
        "conditions above. Nothing else should keep you on the line, so most calls will be "
        "well under two minutes. That is a consequence of asking one question, not a timer: "
        "there is no point at which you should cut off a person who is still helping you."
    )
