#!/bin/bash
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verify SPEC.md exists and contains all required sections
echo "Verifying SPEC.md structure..."
for section in "Customer Confusion" "Concept" "Tools & Features" "Data Model" "Demo Script" "Stack Pin" "Agent Surface" "Plan Brief Authorship" "File Layout" "Test Plan" "PR Target" "Submission Checklist"; do
  if ! grep -q "$section" SPEC.md; then
    echo "ERROR: Missing section in SPEC.md: $section"
    exit 1
  fi
done

# Verify README.md exists
echo "Verifying README.md..."
if [ ! -f README.md ]; then
  echo "ERROR: README.md not found"
  exit 1
fi

# Verify LICENSE exists
echo "Verifying LICENSE..."
if [ ! -f LICENSE ]; then
  echo "ERROR: LICENSE not found"
  exit 1
fi

# Verify submission checklist is present
echo "Verifying submission checklist..."
if ! grep -q "Open a pull request to the" SPEC.md; then
  echo "ERROR: Submission checklist not found in SPEC.md"
  exit 1
fi

# Verify the submission artifact set is present (issue #7). These are what the owner
# submits from, so a missing one is a broken submission, not a missing nicety.
echo "Verifying submission documents..."
for doc in docs/architecture.md docs/architecture.svg docs/task-lifecycle.svg \
           docs/submission.md docs/submission-checklist.md docs/pr-body.md \
           docs/video-script.md; do
  if [ ! -s "$doc" ]; then
    echo "ERROR: missing or empty submission document: $doc"
    exit 1
  fi
done

# The README must name the LICENSE — hackathon rules require a visible open-source
# licence, and a licence nobody is pointed at is not visible.
if ! grep -q "LICENSE" README.md; then
  echo "ERROR: README.md does not name the LICENSE"
  exit 1
fi

# Every sample phone number must be one reserved for fiction, per the hackathon's
# submission checklist. Two jest suites run by `npm test` below check it:
# tests/fictional-numbers.test.js reads every "+", "00" or "011" number, and
# tests/non-phone-digit-runs.test.js reads every other digit run the masker would treat as
# a phone number — both against src/fictional-numbers.js, the same table the real provider
# refuses to dial. (The grep that used to live here only saw "+1-ddd-dddd".)

# A fresh worktree has no node_modules — bootstrap deterministically from the
# committed lockfile before running anything that needs them (mirrors
# entries/opencv/verify.sh's `make setup` guard for its own .venv). Checked against
# node_modules/.package-lock.json, not just the directory's existence — npm only
# writes that file on a completed install, so an interrupted npm ci (an empty or
# partial node_modules/ left behind) still triggers a real reinstall instead of
# silently skipping one.
[ -f node_modules/.package-lock.json ] || npm ci

# Run tests
echo "Running tests..."
npm test

# Run linter — the non-fix variant, since --fix rewrites tracked files during a
# verify gate instead of failing on what it finds (README.md's own noted limitation).
echo "Running linter..."
npm run lint:check

echo "All verification checks passed!"
