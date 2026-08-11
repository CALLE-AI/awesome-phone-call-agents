#!/usr/bin/env python3
"""Safely preview, deduplicate, and create one confirmed GitHub defect."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import ipaddress
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_REPO = "CALLE-AI/awesome-phone-call-agents"
DEFAULT_API_BASE = "https://api.github.com"
API_VERSION = "2026-03-10"
MARKER_PREFIX = "<!-- triage-discord-feedback:v1:"
MAX_BODY_LENGTH = 65_000

SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("authorization credential", re.compile(r"(?i)\b(?:authorization|bearer)\s*[:=]?\s+[A-Za-z0-9._~+/=-]{16,}")),
    (
        "labeled credential",
        re.compile(
            r"(?i)\b[A-Za-z0-9_]*(?:api[_ -]?key|access[_ -]?key|client[_ -]?secret|"
            r"password|secret|token)\b\s*[:=]\s*[\"']?[A-Za-z0-9._~+/=-]{8,}"
        ),
    ),
    (
        "service credential",
        re.compile(r"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b"),
    ),
    ("cookie credential", re.compile(r"(?i)\bcookie\s*[:=]\s*[^\s;]{8,}")),
    ("Discord webhook", re.compile(r"https://(?:canary\.|ptb\.)?discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9._-]+")),
    ("webhook URL", re.compile(r"https://[^\s]+/webhooks?/[^\s]+", re.IGNORECASE)),
    (
        "private artifact URL",
        re.compile(
            r"https://[^\s?#]+(?:/[^\s?#]*)?\."
            r"(?:m4a|mp3|mp4|ogg|srt|vtt|wav|webm)(?:[?#][^\s]*)?",
            re.IGNORECASE,
        ),
    ),
    (
        "private artifact URL",
        re.compile(
            r"(?i)\bprivate\s+(?:audio|log|recording|transcript)(?:\s+url)?"
            r"\s*[:=]\s*https://[^\s]+"
        ),
    ),
)

PII_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email address", re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")),
    (
        "phone number",
        re.compile(r"(?<!\d)(?:\+?\d[\s().-]*){7,15}(?!\d)"),
    ),
    ("Discord invite", re.compile(r"https://(?:www\.)?(?:discord\.gg|discord(?:app)?\.com/invite)/[^\s]+", re.IGNORECASE)),
    ("Discord user ID", re.compile(r"(?<!\d)\d{17,20}(?!\d)")),
    (
        "user handle",
        re.compile(r"(?<![\w@])@[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,62}[A-Za-z0-9_])?"),
    ),
    (
        "legacy Discord handle",
        re.compile(r"(?<![A-Za-z0-9_.-])[A-Za-z0-9_.-]{2,32}#[0-9]{4}\b"),
    ),
    (
        "IPv4 address",
        re.compile(r"(?<!\d)(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d)"),
    ),
)

INTERNAL_CORRELATION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "internal correlation identifier",
        re.compile(
            r"(?i)\b(?:account|bot|call|plan|request|resource|run|task|trace|version)[ _-]?id\b|"
            r"\b[0-9a-f]{32}\b"
        ),
    ),
)

INTERNAL_DIAGNOSTIC_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "internal voice or model signal",
        re.compile(r"(?i)\b(?:ASR|LLM|TTS|TTFT|VAD)\b"),
    ),
    (
        "internal diagnostic detail",
        re.compile(
            r"(?i)\b(?:backend|server-side|server logs?|telemetry|trace spans?|latency|"
            r"media streams?|speech-positive|valid talk rounds?|work status|"
            r"provider routing|model routing)\b"
        ),
    ),
    (
        "internal service or routing detail",
        re.compile(
            r"(?i)\b(?:internal (?:backend|cluster|host|provider|service)|"
            r"provider routing|model routing)\b"
        ),
    ),
    (
        "internal hostname",
        re.compile(r"(?i)\b(?:[a-z0-9-]+\.)+(?:internal|local)\b"),
    ),
)

STOP_WORDS = {
    "a",
    "an",
    "and",
    "for",
    "from",
    "in",
    "of",
    "on",
    "the",
    "to",
    "with",
}

IGNORED_EVIDENCE_SIGNATURES = {
    "call-e",
    "not provided",
}

GITHUB_LOGIN_PATTERN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?")
GITHUB_REPOSITORY_PATTERN = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
SOURCE_IDENTIFIER_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")
SOURCE_IDENTIFIER_LABEL_PATTERN = re.compile(
    r"(?i)\b(?:bot|call|plan|request|resource|run|task|trace|version)[ _-]?id\b"
    r"\s*(?:[:=#-]\s*)?`?\[SOURCE EVIDENCE IDENTIFIER\]`?"
    r"(?![A-Za-z0-9._:-])"
)


class UserError(Exception):
    """An expected input, authorization, or API error."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Fail closed instead of forwarding an authorization header on a redirect."""

    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> None:
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub OWNER/REPO")
    parser.add_argument("--max-pages", type=int, default=10, help=argparse.SUPPRESS)
    parser.set_defaults(api_base=DEFAULT_API_BASE)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("whoami", help="Show the authenticated GitHub actor")
    subparsers.add_parser("check", help="Inspect repository and authenticated permissions")
    subparsers.add_parser("labels", help="List repository labels")

    for command, help_text in (
        ("prepare", "Validate and print the final request without network access"),
        ("duplicates", "Search repository issues for possible duplicates"),
        ("create", "Create the issue after duplicate and privacy checks"),
    ):
        command_parser = subparsers.add_parser(command, help=help_text)
        command_parser.add_argument("--input", required=True, help="JSON file path, or - for stdin")
        if command == "create":
            command_parser.add_argument(
                "--yes",
                action="store_true",
                help="Confirm that the user approved the finalized issue content",
            )
        if command == "create":
            command_parser.add_argument(
                "--allow-duplicate",
                action="store_true",
                help="Create despite a duplicate match after explicit user review",
            )
    args = parser.parse_args()
    if not valid_github_repository(args.repo):
        parser.error("--repo must use OWNER/REPO format")
    if not 1 <= args.max_pages <= 100:
        parser.error("--max-pages must be between 1 and 100")
    return args


def load_spec(path_value: str) -> dict[str, Any]:
    try:
        raw = sys.stdin.read() if path_value == "-" else Path(path_value).read_text(encoding="utf-8")
    except OSError as exc:
        raise UserError(f"Could not read issue JSON: {exc}") from exc
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UserError(f"Invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise UserError("Issue JSON must be an object")
    return value


def find_sensitive(text: str) -> list[str]:
    normalized_text = text.translate(
        str.maketrans(
            {
                "\u00a0": " ",
                "\u2010": "-",
                "\u2011": "-",
                "\u2012": "-",
                "\u2013": "-",
                "\u2014": "-",
                "\u2015": "-",
                "\u202f": " ",
                "\u2212": "-",
            }
        )
    )
    secret_scan_text = normalized_text.replace("`", "").replace("*", "").replace("~", "")
    pii_scan_text = re.sub(
        r"`@call-e/[A-Za-z0-9_.-]+(?:@[A-Za-z0-9_.+-]+)?`",
        "`[PUBLIC SCOPED PACKAGE]`",
        normalized_text,
        flags=re.IGNORECASE,
    )
    findings: list[str] = []
    for name, pattern in SECRET_PATTERNS:
        if pattern.search(secret_scan_text):
            findings.append(name)
    for name, pattern in PII_PATTERNS:
        if pattern.search(pii_scan_text):
            findings.append(name)
    ipv6_candidates = re.findall(
        r"(?<![0-9A-Fa-f:])[0-9A-Fa-f:]{2,39}(?![0-9A-Fa-f:])",
        pii_scan_text,
    )
    for candidate in ipv6_candidates:
        if ":" not in candidate:
            continue
        try:
            if ipaddress.ip_address(candidate).version == 6:
                findings.append("IPv6 address")
                break
        except ValueError:
            continue
    return findings


def find_internal_signals(
    text: str,
    patterns: tuple[tuple[str, re.Pattern[str]], ...],
) -> list[str]:
    return [name for name, pattern in patterns if pattern.search(text)]


def source_identifier_pattern(identifier: str) -> re.Pattern[str]:
    return re.compile(
        rf"(?<![A-Za-z0-9._:-]){re.escape(identifier)}(?![A-Za-z0-9._:-])"
    )


def valid_github_repository(value: object) -> bool:
    if not isinstance(value, str) or not GITHUB_REPOSITORY_PATTERN.fullmatch(value):
        return False
    return all(part not in {".", ".."} for part in value.split("/"))


def validate_spec(value: dict[str, Any]) -> dict[str, Any]:
    supported = {
        "title",
        "body",
        "labels",
        "confirmed_issue_ids",
        "expected_actor",
        "expected_repository",
        "source_evidence_identifiers",
        "investigation_clues",
        "investigation_clues_sufficient",
        "insufficient_clues_confirmed_by_user",
        "approved_duplicate_issue_numbers",
        "approved_fingerprint",
        "semantic_duplicate_review_complete",
    }
    extra = sorted(set(value) - supported)
    if extra:
        raise UserError(f"Unsupported issue fields: {', '.join(extra)}")

    title = value.get("title")
    body = value.get("body")
    labels = value.get("labels", [])
    confirmed_issue_ids = value.get("confirmed_issue_ids")
    expected_actor = value.get("expected_actor")
    expected_repository = value.get("expected_repository")
    source_evidence_identifiers = value.get("source_evidence_identifiers", [])
    investigation_clues = value.get("investigation_clues")
    investigation_clues_sufficient = value.get("investigation_clues_sufficient")
    insufficient_clues_confirmed_by_user = value.get("insufficient_clues_confirmed_by_user")
    approved_duplicate_issue_numbers = value.get("approved_duplicate_issue_numbers", [])
    approved_fingerprint = value.get("approved_fingerprint")
    semantic_duplicate_review_complete = value.get("semantic_duplicate_review_complete")
    if not isinstance(title, str) or not title.strip():
        raise UserError("title must be a non-empty string")
    if len(title.strip()) > 256:
        raise UserError("title must be at most 256 characters")
    if not isinstance(body, str) or not body.strip():
        raise UserError("body must be a non-empty string")
    if len(body) > MAX_BODY_LENGTH:
        raise UserError(f"body must be at most {MAX_BODY_LENGTH} characters")
    if not isinstance(labels, list) or any(not isinstance(label, str) or not label.strip() for label in labels):
        raise UserError("labels must be a list of non-empty strings")
    normalized_labels = [label.strip() for label in labels]
    if any(label != "bug" for label in normalized_labels):
        raise UserError("Only the verified bug label is allowed in this defect workflow")
    if (
        not isinstance(confirmed_issue_ids, list)
        or len(confirmed_issue_ids) != 1
        or any(not isinstance(issue_id, str) or not re.fullmatch(r"I[1-9][0-9]*", issue_id) for issue_id in confirmed_issue_ids)
    ):
        raise UserError("confirmed_issue_ids must contain exactly one ID such as ['I1']")
    if not isinstance(expected_actor, str) or not GITHUB_LOGIN_PATTERN.fullmatch(expected_actor):
        raise UserError("expected_actor must be the GitHub login confirmed by the user")
    if not valid_github_repository(expected_repository):
        raise UserError("expected_repository must be the GitHub OWNER/REPO confirmed by the user")
    if (
        not isinstance(source_evidence_identifiers, list)
        or len(source_evidence_identifiers) > 20
        or any(
            not isinstance(identifier, str)
            or not SOURCE_IDENTIFIER_PATTERN.fullmatch(identifier)
            for identifier in source_evidence_identifiers
        )
    ):
        raise UserError(
            "source_evidence_identifiers must contain at most 20 identifiers using only "
            "letters, digits, periods, underscores, colons, or hyphens"
        )
    if len(set(source_evidence_identifiers)) != len(source_evidence_identifiers):
        raise UserError("source_evidence_identifiers must not contain duplicates")
    if (
        not isinstance(investigation_clues, list)
        or len(investigation_clues) > 20
        or any(
            not isinstance(clue, str)
            or not clue.strip()
            or len(clue.strip()) > 500
            for clue in investigation_clues
        )
    ):
        raise UserError(
            "investigation_clues must contain at most 20 non-empty strings of at most 500 characters"
        )
    normalized_investigation_clues = [clue.strip() for clue in investigation_clues]
    if len(set(normalized_investigation_clues)) != len(normalized_investigation_clues):
        raise UserError("investigation_clues must not contain duplicates")
    if not isinstance(investigation_clues_sufficient, bool):
        raise UserError("investigation_clues_sufficient must be true or false")
    if not isinstance(insufficient_clues_confirmed_by_user, bool):
        raise UserError("insufficient_clues_confirmed_by_user must be true or false")
    if (
        not isinstance(approved_duplicate_issue_numbers, list)
        or len(approved_duplicate_issue_numbers) > 20
        or any(
            not isinstance(issue_number, int) or isinstance(issue_number, bool) or issue_number <= 0
            for issue_number in approved_duplicate_issue_numbers
        )
    ):
        raise UserError(
            "approved_duplicate_issue_numbers must contain at most 20 positive issue numbers"
        )
    if len(set(approved_duplicate_issue_numbers)) != len(approved_duplicate_issue_numbers):
        raise UserError("approved_duplicate_issue_numbers must not contain duplicates")
    if approved_fingerprint is not None and (
        not isinstance(approved_fingerprint, str)
        or not re.fullmatch(r"[0-9a-f]{64}", approved_fingerprint)
    ):
        raise UserError("approved_fingerprint must be null or a lowercase SHA-256 digest")
    if not isinstance(semantic_duplicate_review_complete, bool):
        raise UserError("semantic_duplicate_review_complete must be true or false")
    if investigation_clues_sufficient and not normalized_investigation_clues:
        raise UserError("An issue marked with sufficient investigation clues must declare at least one clue")
    if investigation_clues_sufficient and insufficient_clues_confirmed_by_user:
        raise UserError(
            "insufficient_clues_confirmed_by_user must be false when investigation clues are sufficient"
        )
    if not investigation_clues_sufficient and not insufficient_clues_confirmed_by_user:
        raise UserError(
            "Insufficient investigation clues require the user's explicit confirmation before creation"
        )

    issue_text = f"{title}\n{body}"
    missing_identifiers = [
        identifier
        for identifier in source_evidence_identifiers
        if not source_identifier_pattern(identifier).search(issue_text)
    ]
    if missing_identifiers:
        raise UserError(
            "source_evidence_identifiers are not present in the issue content: "
            + ", ".join(missing_identifiers)
        )
    missing_clues = [clue for clue in normalized_investigation_clues if clue not in issue_text]
    if missing_clues:
        raise UserError(
            "investigation_clues are not present in the issue content: "
            + ", ".join(missing_clues)
        )

    findings = find_sensitive(issue_text)
    if findings:
        raise UserError(
            "Refusing content that may contain sensitive data: "
            + ", ".join(sorted(set(findings)))
            + ". Redact it before continuing."
        )

    internal_signals = find_internal_signals(issue_text, INTERNAL_DIAGNOSTIC_PATTERNS)
    correlation_scan_text = issue_text
    for identifier in sorted(source_evidence_identifiers, key=len, reverse=True):
        correlation_scan_text = source_identifier_pattern(identifier).sub(
            "[SOURCE EVIDENCE IDENTIFIER]",
            correlation_scan_text,
        )
    correlation_scan_text = SOURCE_IDENTIFIER_LABEL_PATTERN.sub(
        "[SOURCE EVIDENCE IDENTIFIER]",
        correlation_scan_text,
    )
    internal_signals.extend(
        find_internal_signals(correlation_scan_text, INTERNAL_CORRELATION_PATTERNS)
    )
    if internal_signals:
        raise UserError(
            "Refusing content that may disclose internal server diagnostics: "
            + ", ".join(sorted(set(internal_signals)))
            + ". Describe only the user-observable product behavior."
        )

    return {
        "title": title.strip(),
        "body": body.rstrip(),
        "labels": normalized_labels,
        "confirmed_issue_ids": confirmed_issue_ids,
        "expected_actor": expected_actor,
        "expected_repository": expected_repository,
        "source_evidence_identifiers": source_evidence_identifiers,
        "investigation_clues": normalized_investigation_clues,
        "investigation_clues_sufficient": investigation_clues_sufficient,
        "insufficient_clues_confirmed_by_user": insufficient_clues_confirmed_by_user,
        "approved_duplicate_issue_numbers": sorted(approved_duplicate_issue_numbers),
        "approved_fingerprint": approved_fingerprint,
        "semantic_duplicate_review_complete": semantic_duplicate_review_complete,
    }


def content_fingerprint(spec: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"title": spec["title"], "body": spec["body"]},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def approval_fingerprint(spec: dict[str, Any]) -> str:
    confirmed = {
        key: spec[key]
        for key in (
            "title",
            "body",
            "labels",
            "confirmed_issue_ids",
            "expected_actor",
            "expected_repository",
            "source_evidence_identifiers",
            "investigation_clues",
            "investigation_clues_sufficient",
            "insufficient_clues_confirmed_by_user",
            "approved_duplicate_issue_numbers",
            "semantic_duplicate_review_complete",
        )
    }
    canonical = json.dumps(
        confirmed,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def prepare_payload(spec: dict[str, Any]) -> tuple[dict[str, Any], str]:
    digest = content_fingerprint(spec)
    marker = f"{MARKER_PREFIX}{digest} -->"
    payload = {
        "title": spec["title"],
        "body": f"{spec['body']}\n\n{marker}",
    }
    if spec["labels"]:
        payload["labels"] = spec["labels"]
    return payload, digest


def token() -> str | None:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def require_trusted_api_url(url: str) -> None:
    expected = urllib.parse.urlsplit(DEFAULT_API_BASE)
    actual = urllib.parse.urlsplit(url)
    if (
        actual.scheme != "https"
        or actual.hostname != expected.hostname
        or actual.port not in {None, 443}
        or actual.username is not None
        or actual.password is not None
    ):
        raise UserError("Refusing a GitHub API request outside https://api.github.com")


def api_request(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    require_token: bool = False,
) -> Any:
    require_trusted_api_url(url)
    auth_token = token()
    if require_token and not auth_token:
        raise UserError("Set GITHUB_TOKEN or GH_TOKEN; the token must have repository Issues write permission")
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "triage-discord-feedback-skill",
        "X-GitHub-Api-Version": API_VERSION,
    }
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    opener = urllib.request.build_opener(NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(raw).get("message", raw)
        except json.JSONDecodeError:
            message = raw
        hint = ""
        if exc.code in {401, 403, 404}:
            hint = " Check token access and repository Issues permissions."
        elif exc.code == 410:
            hint = " Repository issues may be disabled."
        raise UserError(f"GitHub API {exc.code}: {message}.{hint}") from exc
    except urllib.error.URLError as exc:
        raise UserError(f"Could not reach GitHub API: {exc.reason}") from exc


def repo_url(api_base: str, repo: str, suffix: str = "") -> str:
    return f"{api_base.rstrip('/')}/repos/{repo}{suffix}"


def authenticated_actor(api_base: str) -> dict[str, Any]:
    value = api_request("GET", f"{api_base.rstrip('/')}/user", require_token=True)
    if not isinstance(value, dict) or not isinstance(value.get("login"), str):
        raise UserError("GitHub did not return an authenticated actor login")
    return {
        "html_url": value.get("html_url"),
        "login": value["login"],
        "type": value.get("type"),
    }


def list_issues(args: argparse.Namespace) -> tuple[list[dict[str, Any]], bool]:
    issues: list[dict[str, Any]] = []
    scan_complete = False
    for page in range(1, args.max_pages + 1):
        query = urllib.parse.urlencode({"state": "all", "per_page": 100, "page": page})
        value = api_request("GET", repo_url(args.api_base, args.repo, f"/issues?{query}"))
        if not isinstance(value, list):
            raise UserError("Unexpected response while listing issues")
        page_items = [item for item in value if isinstance(item, dict) and "pull_request" not in item]
        issues.extend(page_items)
        if len(value) < 100:
            scan_complete = True
            break
    return issues, scan_complete


def list_labels(args: argparse.Namespace) -> tuple[list[dict[str, Any]], bool]:
    labels: list[dict[str, Any]] = []
    scan_complete = False
    for page in range(1, args.max_pages + 1):
        query = urllib.parse.urlencode({"per_page": 100, "page": page})
        value = api_request(
            "GET",
            repo_url(args.api_base, args.repo, f"/labels?{query}"),
        )
        if not isinstance(value, list):
            raise UserError("Unexpected response while listing labels")
        labels.extend(item for item in value if isinstance(item, dict))
        if len(value) < 100:
            scan_complete = True
            break
    return labels, scan_complete


def list_issue_comments(
    args: argparse.Namespace,
    issues: list[dict[str, Any]],
) -> tuple[dict[int, list[dict[str, Any]]], dict[str, Any]]:
    comments_by_issue: dict[int, list[dict[str, Any]]] = {}
    scanned_comment_issues = 0
    scanned_comments = 0
    comment_scan_complete = True

    for issue in issues:
        number = issue.get("number")
        expected_count = issue.get("comments")
        if not isinstance(number, int) or not isinstance(expected_count, int) or expected_count <= 0:
            continue

        scanned_comment_issues += 1
        issue_comments: list[dict[str, Any]] = []
        for page in range(1, args.max_pages + 1):
            query = urllib.parse.urlencode({"per_page": 100, "page": page})
            value = api_request(
                "GET",
                repo_url(args.api_base, args.repo, f"/issues/{number}/comments?{query}"),
            )
            if not isinstance(value, list):
                raise UserError(f"Unexpected response while listing comments for issue #{number}")
            issue_comments.extend(item for item in value if isinstance(item, dict))
            if len(value) < 100:
                break

        comments_by_issue[number] = issue_comments
        scanned_comments += len(issue_comments)
        if len(issue_comments) < expected_count:
            comment_scan_complete = False

    return comments_by_issue, {
        "comment_scan_complete": comment_scan_complete,
        "scanned_comment_issues": scanned_comment_issues,
        "scanned_comments": scanned_comments,
    }


def title_tokens(title: str) -> set[str]:
    return {
        word
        for word in re.findall(r"[a-z0-9]+", title.lower())
        if len(word) > 1 and word not in STOP_WORDS
    }


def title_similarity(left: str, right: str) -> float:
    left_normalized = " ".join(re.findall(r"[a-z0-9]+", left.lower()))
    right_normalized = " ".join(re.findall(r"[a-z0-9]+", right.lower()))
    if left_normalized == right_normalized:
        return 1.0
    left_tokens = title_tokens(left)
    right_tokens = title_tokens(right)
    union = left_tokens | right_tokens
    jaccard = len(left_tokens & right_tokens) / len(union) if union else 0.0
    sequence = difflib.SequenceMatcher(None, left_normalized, right_normalized).ratio()
    return max(jaccard, sequence)


def evidence_signatures(text: str) -> set[str]:
    values = re.findall(r"`([^`\n]{5,200})`", text)
    for block in re.findall(r"```(?:[^\n]*\n)?(.*?)```", text, flags=re.DOTALL):
        values.extend(block.splitlines())

    signatures = set()
    for value in values:
        normalized = " ".join(value.lower().split()).strip(" .,:;\"'")
        if 8 <= len(normalized) <= 200 and normalized not in IGNORED_EVIDENCE_SIGNATURES:
            signatures.add(normalized)
    return signatures


def normalize_evidence_anchor(value: str) -> str:
    return " ".join(value.replace("`", "").lower().split()).strip(" .,:;\"'")


def investigation_anchors(spec: dict[str, Any]) -> set[str]:
    values = list(spec.get("investigation_clues", [])) + list(
        spec.get("source_evidence_identifiers", [])
    )
    anchors = {normalize_evidence_anchor(value) for value in values}
    return {
        anchor
        for anchor in anchors
        if 5 <= len(anchor) <= 500 and anchor not in IGNORED_EVIDENCE_SIGNATURES
    }


def anchors_present(anchors: set[str], text: str) -> set[str]:
    searchable = normalize_evidence_anchor(text)
    return {anchor for anchor in anchors if anchor in searchable}


def duplicate_matches(
    spec: dict[str, Any],
    digest: str,
    issues: list[dict[str, Any]],
    comments_by_issue: dict[int, list[dict[str, Any]]] | None = None,
    threshold: float = 0.72,
) -> list[dict[str, Any]]:
    marker = f"{MARKER_PREFIX}{digest} -->"
    matches: list[dict[str, Any]] = []
    new_evidence = evidence_signatures(spec["body"]) | investigation_anchors(spec)
    for issue in issues:
        issue_number = issue.get("number")
        existing_title = str(issue.get("title") or "")
        existing_body = str(issue.get("body") or "")
        comments = (
            comments_by_issue.get(issue_number, [])
            if comments_by_issue is not None and isinstance(issue_number, int)
            else []
        )
        existing_comments = "\n".join(str(comment.get("body") or "") for comment in comments)
        score = title_similarity(spec["title"], existing_title)
        exact_fingerprint = marker in existing_body or marker in existing_comments
        shared_body_evidence = (
            new_evidence & evidence_signatures(existing_body)
        ) | anchors_present(new_evidence, existing_body)
        shared_comment_evidence = (
            new_evidence & evidence_signatures(existing_comments)
        ) | anchors_present(new_evidence, existing_comments)
        shared_evidence = sorted(shared_body_evidence | shared_comment_evidence)
        if exact_fingerprint or shared_evidence or score >= threshold:
            if exact_fingerprint:
                reason = "exact fingerprint"
            elif shared_comment_evidence:
                reason = "shared technical evidence in comments"
            elif shared_evidence:
                reason = "shared technical evidence"
            else:
                reason = "similar title"
            matches.append(
                {
                    "number": issue.get("number"),
                    "state": issue.get("state"),
                    "title": existing_title,
                    "url": issue.get("html_url"),
                    "reason": reason,
                    "shared_evidence": shared_evidence[:5],
                    "matched_in_comments": bool(shared_comment_evidence),
                    "similarity": round(score, 3),
                }
            )
    priority = {
        "exact fingerprint": 0,
        "shared technical evidence in comments": 1,
        "shared technical evidence": 2,
        "similar title": 3,
    }
    return sorted(matches, key=lambda item: (priority[item["reason"]], -item["similarity"]))


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def require_duplicate_approval(
    matches: list[dict[str, Any]],
    approved_issue_numbers: list[int],
    allow_duplicate: bool,
) -> None:
    current_issue_numbers: list[int] = []
    for match in matches:
        number = match.get("number")
        if not isinstance(number, int):
            raise UserError("A duplicate match is missing a reviewable issue number")
        current_issue_numbers.append(number)
    current = sorted(set(current_issue_numbers))
    approved = sorted(approved_issue_numbers)

    if not current and (allow_duplicate or approved):
        raise UserError(
            "Duplicate override metadata is stale because no current duplicate match exists"
        )
    if current and not allow_duplicate:
        raise UserError(
            "Possible duplicate found; review it before using --allow-duplicate"
        )
    if allow_duplicate and current != approved:
        raise UserError(
            "Current duplicate matches do not equal approved_duplicate_issue_numbers; "
            "stop and reconfirm"
        )


def main() -> int:
    args = parse_args()

    if args.command == "whoami":
        print_json(authenticated_actor(args.api_base))
        return 0

    if args.command == "check":
        value = api_request("GET", repo_url(args.api_base, args.repo))
        print_json(
            {
                "archived": value.get("archived"),
                "authenticated": token() is not None,
                "full_name": value.get("full_name"),
                "has_issues": value.get("has_issues"),
                "permissions": value.get("permissions"),
                "visibility": value.get("visibility"),
            }
        )
        return 0

    if args.command == "labels":
        labels, label_scan_complete = list_labels(args)
        print_json(
            {
                "labels": [
                    {"name": item.get("name"), "description": item.get("description")}
                    for item in labels
                ],
                "repository": args.repo,
                "scan_complete": label_scan_complete,
            }
        )
        return 0

    spec = validate_spec(load_spec(args.input))
    if spec["expected_repository"].casefold() != args.repo.casefold():
        raise UserError(
            f"Requested repository {args.repo} does not match expected_repository "
            f"{spec['expected_repository']}; stop and reconfirm"
        )
    payload, content_digest = prepare_payload(spec)
    approval_digest = approval_fingerprint(spec)

    if args.command == "create" and spec["approved_fingerprint"] != approval_digest:
        raise UserError(
            "approved_fingerprint does not match the finalized issue preview; stop and reconfirm"
        )
    if args.command == "create" and not spec["semantic_duplicate_review_complete"]:
        raise UserError(
            "Creation requires a completed semantic duplicate review of open and closed "
            "issue titles, bodies, and comments"
        )

    if args.command == "prepare":
        print_json(
            {
                "confirmed_issue_ids": spec["confirmed_issue_ids"],
                "expected_actor": spec["expected_actor"],
                "expected_repository": spec["expected_repository"],
                "source_evidence_identifiers": spec["source_evidence_identifiers"],
                "investigation_clues": spec["investigation_clues"],
                "investigation_clues_sufficient": spec["investigation_clues_sufficient"],
                "insufficient_clues_confirmed_by_user": spec[
                    "insufficient_clues_confirmed_by_user"
                ],
                "approved_duplicate_issue_numbers": spec[
                    "approved_duplicate_issue_numbers"
                ],
                "semantic_duplicate_review_complete": spec[
                    "semantic_duplicate_review_complete"
                ],
                "approval_fingerprint": approval_digest,
                "content_fingerprint": content_digest,
                "payload": payload,
                "repository": args.repo,
            }
        )
        return 0

    issues, issue_scan_complete = list_issues(args)
    comments_by_issue, comment_scan = list_issue_comments(args, issues)
    matches = duplicate_matches(spec, content_digest, issues, comments_by_issue)
    if args.command == "duplicates":
        print_json(
            {
                "confirmed_issue_ids": spec["confirmed_issue_ids"],
                "expected_actor": spec["expected_actor"],
                "matches": matches,
                "approval_fingerprint": approval_digest,
                "repository": args.repo,
                "issue_scan_complete": issue_scan_complete,
                "scanned_issues": len(issues),
                **comment_scan,
            }
        )
        if matches:
            return 2
        return 0 if issue_scan_complete else 3

    if not args.yes:
        raise UserError("Creation requires --yes after the user confirms the finalized defect issue IDs")
    if matches and not args.allow_duplicate:
        print_json({"matches": matches, "repository": args.repo})
    require_duplicate_approval(
        matches,
        spec["approved_duplicate_issue_numbers"],
        args.allow_duplicate,
    )
    if not issue_scan_complete:
        raise UserError(
            "Duplicate issue scan was incomplete; increase --max-pages before creating the issue"
        )
    if not comment_scan["comment_scan_complete"]:
        raise UserError(
            "Duplicate comment scan was incomplete; increase --max-pages before creating the issue"
        )
    if spec["labels"]:
        available_labels, label_scan_complete = list_labels(args)
        available_names = {
            item.get("name") for item in available_labels if isinstance(item.get("name"), str)
        }
        missing_labels = sorted(set(spec["labels"]) - available_names)
        if missing_labels and not label_scan_complete:
            raise UserError(
                "Repository label scan was incomplete; increase --max-pages before creating the issue"
            )
        if missing_labels:
            raise UserError(
                "Confirmed labels do not exist in the repository: " + ", ".join(missing_labels)
            )

    actor = authenticated_actor(args.api_base)
    if actor["login"].casefold() != spec["expected_actor"].casefold():
        raise UserError(
            f"Authenticated GitHub actor @{actor['login']} does not match "
            f"expected_actor @{spec['expected_actor']}; stop and reconfirm"
        )

    created = api_request(
        "POST",
        repo_url(args.api_base, args.repo, "/issues"),
        payload=payload,
        require_token=True,
    )
    print_json(
        {
            "created": True,
            "actor": actor,
            "confirmed_issue_ids": spec["confirmed_issue_ids"],
            "number": created.get("number"),
            "repository": args.repo,
            "title": created.get("title"),
            "url": created.get("html_url"),
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UserError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
