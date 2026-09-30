"""A fictional demo roster.

Every number here comes from a range reserved for fiction -- Ofcom's
+44 7700 900xxx drama block and the North American 555-01xx block -- so nothing
in this repository can dial a real person. Names are invented.

The six subjects exist to exercise the interesting outcomes, not to flatter
the system: most of them do not close without a person.
"""

from __future__ import annotations

from datetime import date

from .models import Accessibility, KnowledgePrompt, Subject
from .register import RegisterEntry, RegisterStatus

ROSTER: tuple[Subject, ...] = (
    Subject(
        subject_id="s-1041",
        display_name="Agnes Oduro",
        phone_e164="+447700900141",
        country_code="GB",
        language="English",
        reference="PEN-1041",
        date_of_birth=date(1938, 4, 11),
        prompts=(),
    ),
    Subject(
        subject_id="s-1042",
        display_name="Tomas Weber",
        phone_e164="+447700900142",
        country_code="GB",
        language="English",
        reference="PEN-1042",
        prompts=(),
    ),
    Subject(
        subject_id="s-1043",
        display_name="Marguerite Baptiste",
        phone_e164="+12025550143",
        country_code="US",
        language="English",
        reference="PEN-1043",
        prompts=(),
    ),
    Subject(
        subject_id="s-1044",
        display_name="Henry Achterberg",
        phone_e164="+12025550144",
        country_code="US",
        language="English",
        reference="PEN-1044",
        # Enrolled as needing a person. Muster must never fail him by machine.
        accessibility=Accessibility(hearing_impaired=True),
        prompts=(),
    ),
    Subject(
        subject_id="s-1046",
        display_name="Beatrice Nkrumah",
        phone_e164="+447700900146",
        country_code="GB",
        language="English",
        reference="PEN-1046",
        # The register has recorded her death. She has not died. Under the
        # paper process she has no channel to say so.
        prompts=(),
    ),
    Subject(
        subject_id="s-1045",
        display_name="Sofia Kallas",
        phone_e164="+447700900145",
        country_code="GB",
        language="English",
        reference="PEN-1045",
        prompts=(),
    ),
)

BY_ID = {subject.subject_id: subject for subject in ROSTER}

#: A demo death-register feed. Deliberately wrong about one living person,
#: because that is the failure the paper process cannot surface.
REGISTER: dict[str, RegisterEntry] = {
    "s-1046": RegisterEntry(
        subject_id="s-1046",
        status=RegisterStatus.DECEASED,
        recorded_on=date(2026, 6, 2),
    ),
}


def register_entry(subject_id: str) -> RegisterEntry | None:
    return REGISTER.get(subject_id)


def get(subject_id: str) -> Subject:
    if subject_id not in BY_ID:
        raise KeyError(f"no enrolled subject {subject_id!r}")
    return BY_ID[subject_id]
