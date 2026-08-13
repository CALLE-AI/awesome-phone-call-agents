import re
from typing import Any


YES_WORDS = {
    "yes", "yeah", "yep", "haan", "han", "ha", "ji", "sure", "okay", "ok",
    "हाँ", "हां", "जी", "ठीक", "बिल्कुल",
}
NO_WORDS = {
    "no", "nope", "nahi", "nahin", "na",
    "नहीं", "नही", "ना",
}

NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4,
    "paanch": 5, "panch": 5, "chhe": 6, "che": 6, "saat": 7,
    "aath": 8, "nau": 9, "das": 10,
    "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
    "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
}

THOUSAND_WORDS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "twenty five": 25, "twenty-five": 25, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80,
    "ninety": 90, "hundred": 100,
    "das": 10, "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14,
    "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18, "unnis": 19,
    "bees": 20, "ikkis": 21, "baais": 22, "teis": 23, "chaubis": 24,
    "pachis": 25, "pachees": 25, "chhabbis": 26, "sattais": 27,
    "atthais": 28, "untees": 29, "tees": 30, "chaalis": 40, "pachaas": 50,
    "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90,
    "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14,
    "पंद्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19,
    "बीस": 20, "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24,
    "पच्चीस": 25, "छब्बीस": 26, "सत्ताईस": 27, "अट्ठाईस": 28, "उनतीस": 29,
    "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70,
    "अस्सी": 80, "नब्बे": 90,
}


def _plain(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if hasattr(value, "model_dump"):
        try:
            return _plain(value.model_dump())
        except Exception:
            pass
    if hasattr(value, "dict"):
        try:
            return _plain(value.dict())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return {k: _plain(v) for k, v in vars(value).items() if not k.startswith("_")}
        except Exception:
            pass
    return str(value)


def _find_first_string(data: Any, key: str) -> str:
    if isinstance(data, dict):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        for child in data.values():
            found = _find_first_string(child, key)
            if found:
                return found
    elif isinstance(data, list):
        for child in data:
            found = _find_first_string(child, key)
            if found:
                return found
    return ""


def _find_transcript_turns(data: Any) -> list[dict]:
    found = []

    def walk(value: Any):
        if isinstance(value, dict):
            turns = value.get("transcript_turns")
            if isinstance(turns, list):
                for turn in turns:
                    if isinstance(turn, dict):
                        speaker = str(turn.get("speaker", "")).strip().lower()
                        text = str(turn.get("text", "")).strip()
                        if speaker and text:
                            found.append({
                                "speaker": speaker,
                                "text": text,
                                "offset_seconds": turn.get("offset_seconds"),
                            })
            for key, child in value.items():
                if key != "transcript_turns":
                    walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(data)

    unique = []
    seen = set()
    for turn in found:
        marker = (turn["speaker"], turn["text"], turn.get("offset_seconds"))
        if marker not in seen:
            seen.add(marker)
            unique.append(turn)
    return unique


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _is_yes(text: str) -> bool:
    low = _clean(text)
    tokens = set(re.findall(r"[a-zA-Z\u0900-\u097F]+", low))
    if tokens & YES_WORDS:
        return True
    return any(x in low for x in [
        "bilkul", "बिल्कुल", "kar rahe", "कर रहे", "hiring hai", "हायरिंग है",
        "hire kar", "हायर कर",
    ])


def _is_no(text: str) -> bool:
    low = _clean(text)
    tokens = set(re.findall(r"[a-zA-Z\u0900-\u097F]+", low))
    if tokens & NO_WORDS:
        return True
    return any(x in low for x in [
        "nahi kar rahe", "नहीं कर रहे", "not hiring", "no hiring",
        "कोई हायरिंग नहीं", "हायर नहीं",
    ])


def _number_from_answer(text: str):
    # Digits first.
    m = re.search(r"(?<!\d)(\d{1,3})(?!\d)", text)
    if m:
        return int(m.group(1))

    low = _clean(text)
    for word, value in NUMBER_WORDS.items():
        if re.search(rf"(?<!\w){re.escape(word)}(?!\w)", low):
            return value
    return None


def _salary_value_from_phrase(text: str):
    low = _clean(text).replace(",", "")

    # 25000 / ₹25000
    nums = [int(x) for x in re.findall(r"(?<!\d)(\d{4,6})(?!\d)", low)]
    nums = [x for x in nums if 5000 <= x <= 500000]
    if nums:
        return nums

    # 25k
    vals = []
    for m in re.finditer(r"(?<!\d)(\d{1,3}(?:\.\d+)?)\s*k\b", low):
        vals.append(int(float(m.group(1)) * 1000))
    if vals:
        return vals

    # 25 thousand / 25 हजार
    for m in re.finditer(r"(?<!\d)(\d{1,3}(?:\.\d+)?)\s*(?:thousand|hazaar|hazar|हजार)", low):
        vals.append(int(float(m.group(1)) * 1000))
    if vals:
        return vals

    # पच्चीस हजार / pachees hazaar / twenty five thousand
    for word, value in sorted(THOUSAND_WORDS.items(), key=lambda x: len(x[0]), reverse=True):
        if re.search(rf"(?<!\w){re.escape(word)}(?!\w)\s*(?:thousand|hazaar|hazar|हजार)", low):
            vals.append(value * 1000)

    return vals


def _salary_from_answer(text: str):
    vals = _salary_value_from_phrase(text)
    vals = [v for v in vals if 5000 <= v <= 500000]
    if not vals:
        return None, None

    unique = []
    for v in vals:
        if v not in unique:
            unique.append(v)

    if len(unique) >= 2:
        return min(unique[:2]), max(unique[:2])
    return unique[0], unique[0]


def _question_type(text: str):
    low = _clean(text)

    if any(k in low for k in [
        "which language", "preferred language", "english or hindi",
        "कौन सी भाषा", "किस भाषा", "हिंदी या अंग्रेजी", "अंग्रेजी या हिंदी",
    ]):
        return "language"

    if any(k in low for k in [
        "how many opening", "how many position", "how many vacancies",
        "kitni opening", "kitne opening", "कितनी ओपनिंग", "कितनी वैकेंसी",
        "कितने पद", "कितनी जगह",
    ]):
        return "openings"

    if any(k in low for k in [
        "salary", "pay", "monthly compensation", "per month",
        "वेतन", "सैलरी", "तनख्वाह", "महीने",
    ]):
        return "salary"

    if any(k in low for k in [
        "shift", "day shift", "night shift", "rotational",
        "शिफ्ट", "दिन की शिफ्ट", "रात की शिफ्ट",
    ]):
        return "shift"

    if any(k in low for k in [
        "experience", "fresher", "अनुभव", "फ्रेशर",
    ]):
        return "experience"

    if any(k in low for k in [
        "skill", "skills", "requirement", "requirements",
        "स्किल", "कौशल", "योग्यता",
    ]):
        return "skills"

    if any(k in low for k in [
        "when should", "joining", "join", "start date", "kab join",
        "कब जॉइन", "जॉइनिंग", "कब से",
    ]):
        return "joining"

    if any(k in low for k in [
        "refer suitable", "refer candidates", "candidate refer", "referral",
        "कैंडिडेट रेफर", "उम्मीदवार भेज", "रेफर कर",
    ]):
        return "referral"

    if any(k in low for k in [
        "contact you again", "contact again", "future hiring", "follow up", "dobara contact",
        "दोबारा संपर्क", "फिर से संपर्क", "भविष्य में संपर्क", "दोबारा कॉल",
    ]):
        return "follow_up"

    if any(k in low for k in [
        "currently hiring", "are you hiring", "hiring for", "hire for",
        "अभी भर्ती", "अभी हायर", "भर्ती कर रहे", "हायर कर रहे",
    ]):
        return "hiring"

    if any(k in low for k in [
        "one minute", "permission", "may i speak", "can i speak", "baat kar",
        "एक मिनट", "बात कर सकता", "बात कर सकती", "अनुमति",
    ]):
        return "permission"

    return None


def _normalize_language(answer: str):
    low = _clean(answer)
    if "hinglish" in low or "हिंग्लिश" in low:
        return "Hinglish"
    if "english" in low or "अंग्रेजी" in low or "इंग्लिश" in low:
        return "English"
    if "hindi" in low or "हिंदी" in low or "हिन्दी" in low:
        return "Hindi"
    return None


def _normalize_shift(answer: str):
    low = _clean(answer)

    rotational = any(x in low for x in ["rotational", "rotation", "रोटेशनल", "बदलती"])
    day = any(x in low for x in ["day shift", "day", "दिन की शिफ्ट", "दिन"])
    night = any(x in low for x in ["night shift", "night", "रात की शिफ्ट", "रात"])

    if rotational:
        return "Rotational"
    if day and night:
        return "Day / Night"
    if night:
        return "Night"
    if day:
        return "Day"
    return None


def _normalize_joining(answer: str):
    low = _clean(answer)

    if any(x in low for x in ["immediate", "immediately", "abhi", "तुरंत", "अभी"]):
        return "Immediate"

    m = re.search(r"(?:within\s+)?(\d+)\s*(?:days?|दिन)", low)
    if m:
        return f"Within {m.group(1)} days"

    if "next month" in low or "अगले महीने" in low:
        return "Next month"

    if answer.strip():
        return answer.strip()
    return None


def _role_from_question(question: str):
    known = [
        "Warehouse Assistant", "Reception / Office Assistant", "Reception Assistant",
        "Office Assistant", "Retail Associate", "Store Assistant",
    ]
    for role in known:
        if role.lower() in question.lower():
            return role
    return None


def _role_from_summary(summary: str):
    known = [
        "Warehouse Assistant", "Reception/Office Assistant", "Reception / Office Assistant",
        "Office Assistant", "Reception Assistant", "Retail Associate", "Store Assistant",
    ]
    for role in known:
        if role.lower() in summary.lower():
            return role
    return None


def _extract_qa(turns: list[dict]):
    pairs = []
    last_bot = None

    for turn in turns:
        speaker = turn["speaker"]
        text = turn["text"]

        if speaker in {"bot", "assistant", "agent", "ai"}:
            last_bot = text
        elif speaker in {"user", "callee", "human", "recipient"} and last_bot:
            pairs.append((last_bot, text))
            last_bot = None

    return pairs


def parse_hiring_result(call: Any, business_name: str) -> dict:
    data = _plain(call)
    summary = _find_first_string(data, "summary")
    turns = _find_transcript_turns(data)
    qa_pairs = _extract_qa(turns)

    selected_language = None
    permission_to_continue = None
    hiring_status = "unclear"
    job_title = None
    number_of_openings = None
    salary_min = None
    salary_max = None
    shift = None
    experience_required = None
    skills_required = []
    joining_timeline = None
    candidate_referrals_allowed = "unclear"
    future_follow_up_allowed = None

    for question, answer in qa_pairs:
        qtype = _question_type(question)

        if qtype == "language":
            selected_language = _normalize_language(answer)

        elif qtype == "permission":
            if _is_yes(answer):
                permission_to_continue = True
            elif _is_no(answer):
                permission_to_continue = False

        elif qtype == "hiring":
            if _is_no(answer):
                hiring_status = "not_hiring"
            elif _is_yes(answer) or any(x in _clean(answer) for x in [
                "hiring", "opening", "required", "need",
                "भर्ती", "हायर", "जरूरत", "आवश्यक",
            ]):
                hiring_status = "hiring_now"
                job_title = job_title or _role_from_question(question)

        elif qtype == "openings":
            value = _number_from_answer(answer)
            if value is not None:
                number_of_openings = value

        elif qtype == "salary":
            lo, hi = _salary_from_answer(answer)
            if lo is not None:
                salary_min, salary_max = lo, hi

        elif qtype == "shift":
            value = _normalize_shift(answer)
            if value:
                shift = value

        elif qtype == "experience":
            if answer.strip():
                experience_required = answer.strip()

        elif qtype == "skills":
            if answer.strip() and not _is_no(answer):
                skills_required = [
                    x.strip()
                    for x in re.split(r",| and | aur | और ", answer)
                    if x.strip()
                ]

        elif qtype == "joining":
            joining_timeline = _normalize_joining(answer)

        elif qtype == "referral":
            if _is_yes(answer):
                candidate_referrals_allowed = "yes"
            elif _is_no(answer):
                candidate_referrals_allowed = "no"

        elif qtype == "follow_up":
            if _is_yes(answer):
                future_follow_up_allowed = True
            elif _is_no(answer):
                future_follow_up_allowed = False

    slow = _clean(summary)

    # Summary is used only as a broad fallback. Numeric fields and shift
    # come ONLY from actual recipient answers in transcript Q&A.
    if hiring_status == "unclear":
        if any(p in slow for p in [
            "confirmed they are hiring", "confirmed he is hiring",
            "confirmed she is hiring", "currently hiring",
            "भर्ती कर रहे", "हायर कर रहे",
        ]):
            hiring_status = "hiring_now"
        elif any(p in slow for p in [
            "not hiring", "no current openings", "भर्ती नहीं", "हायर नहीं",
        ]):
            hiring_status = "not_hiring"

    if not job_title:
        job_title = _role_from_summary(summary)

    if permission_to_continue is None and turns:
        has_user = any(
            t["speaker"] in {"user", "callee", "human", "recipient"}
            for t in turns
        )
        if has_user and len(qa_pairs) >= 2:
            permission_to_continue = True

    if candidate_referrals_allowed == "unclear":
        if any(p in slow for p in [
            "allowed jobradar to refer", "can refer candidates",
            "refer suitable candidates",
        ]):
            candidate_referrals_allowed = "yes"
        elif any(p in slow for p in [
            "cannot refer", "no referrals", "do not refer",
        ]):
            candidate_referrals_allowed = "no"

    if future_follow_up_allowed is None:
        if any(p in slow for p in [
            "contact them again", "contact him again", "contact her again",
            "contact again in the future", "follow up again",
        ]):
            future_follow_up_allowed = True
        elif any(p in slow for p in [
            "do not contact again", "no future follow-up", "do not call again",
        ]):
            future_follow_up_allowed = False
        else:
            future_follow_up_allowed = False

    missing_information = []

    if hiring_status == "unclear":
        missing_information.append("Hiring status")

    if hiring_status in {"hiring_now", "hiring_soon"}:
        if not job_title:
            missing_information.append("Role")
        if number_of_openings is None:
            missing_information.append("Openings")
        if salary_min is None:
            missing_information.append("Salary")
        if not shift:
            missing_information.append("Shift")
        if not experience_required:
            missing_information.append("Experience")
        if not skills_required:
            missing_information.append("Skills")
        if not joining_timeline:
            missing_information.append("Joining timeline")

    if hiring_status == "not_hiring" and permission_to_continue is True:
        verification_status = "verified"
    elif hiring_status == "hiring_now":
        core = [job_title, number_of_openings, salary_min, shift]
        confirmed_core = sum(x is not None and x != "" for x in core)
        verification_status = "verified" if confirmed_core >= 3 else "partially_verified"
    elif hiring_status == "hiring_soon":
        verification_status = "future_demand"
    else:
        verification_status = "unverified"

    transcript_for_ui = [
        {
            "speaker": t["speaker"],
            "text": t["text"],
            "offset_seconds": t.get("offset_seconds"),
        }
        for t in turns
    ]

    return {
        "business_name": business_name,
        "selected_language": selected_language,
        "permission_to_continue": permission_to_continue,
        "hiring_status": hiring_status,
        "job_title": job_title,
        "number_of_openings": number_of_openings,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "shift": shift,
        "experience_required": experience_required,
        "skills_required": skills_required,
        "joining_timeline": joining_timeline,
        "candidate_referrals_allowed": candidate_referrals_allowed,
        "future_follow_up_allowed": bool(future_follow_up_allowed),
        "missing_information": missing_information,
        "verification_status": verification_status,
        "follow_up_required": bool(
            hiring_status in {"hiring_now", "hiring_soon"} and missing_information
        ),
        "call_summary": summary or "No CALL-E summary was available.",
        "call_transcript": transcript_for_ui,
    }
