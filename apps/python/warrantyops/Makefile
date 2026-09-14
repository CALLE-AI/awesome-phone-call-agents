# WarrantyOps quality gates.
#
#   make test           the deterministic suite (pytest)
#   make scenarios      every synthetic scenario through the CLI, refusing or
#                       completing cleanly but never crashing
#   make judge          the offline judge path: suite, repository validator,
#                       byte-identical proof screen and adversarial page,
#                       scenarios, hygiene audit and git diff --check — no
#                       credentials, network or SDK
#   make check          the release gate: everything above except the external
#                       hygiene tool, plus the F7 static quality legs (mypy
#                       --strict, ruff, pip-audit), branch coverage at its 95%
#                       floor, generated-docs byte-identity, and an explicit
#                       hypothesis-present guard so the property suite can
#                       never silently skip. `make check` is therefore
#                       stricter than the offline `make judge`; its pip-audit
#                       leg needs the network at gate time.
#
# PYTHON is the pinned interpreter (a Python 3.9 environment with pytest 8.x;
# the core must stay 3.9-compatible). HYGIENE_AUDIT is the path to the owner's
# repository hygiene audit tool, supplied explicitly because it lives outside
# this repository:
#
#   make judge PYTHON=/path/to/python3.9 HYGIENE_AUDIT=/path/to/repo_hygiene_audit.py

PYTHON ?= python3
HYGIENE_AUDIT ?=
# This Makefile lives at apps/python/warrantyops/, three levels below the root.
REPO_ROOT := $(abspath ../../..)

# Repo safety: every git read this Makefile makes takes no optional locks.
export GIT_OPTIONAL_LOCKS = 0

# Recipes use POSIX shell constructs (for/done loops), so Windows hosts must
# run them under bash; Git for Windows ships it and GitHub's windows runners
# have it on PATH. A no-op on macOS and Linux.
SHELL := bash

.PHONY: test validator proof adversarial scenarios diff-check hygiene \
	static coverage-gate docs hypothesis-present quality check judge \
	contract-live

test:
	$(PYTHON) -m pytest -q

validator:
	cd $(REPO_ROOT) && $(PYTHON) scripts/validate_repository.py

proof:
	$(PYTHON) -m warrantyops --verify-proof-screen

# Same byte-identity discipline as the proof screen, for the adversarial
# page: re-execute the eighteen families and compare against the checked-in
# artifact. A kernel change that alters any refusal fails here.
adversarial:
	$(PYTHON) -m warrantyops --verify-adversarial

docs:
	$(PYTHON) -m warrantyops --verify-docs

scenarios:
	@for s in $$($(PYTHON) -m warrantyops --list); do \
		echo "-- scenario $$s"; \
		$(PYTHON) -m warrantyops --scenario $$s > /dev/null 2>&1; \
		rc=$$?; \
		if [ $$rc -gt 1 ]; then \
			echo "FAIL: $$s exited $$rc (a clean refusal is 1, a crash is not)"; \
			exit 1; \
		fi; \
		$(PYTHON) -m warrantyops --scenario $$s --approve > /dev/null 2>&1; \
		rc=$$?; \
		if [ $$rc -gt 1 ]; then \
			echo "FAIL: $$s --approve exited $$rc"; \
			exit 1; \
		fi; \
	done
	@echo "scenarios: all clean"

diff-check:
	@git -C $(REPO_ROOT) diff --check && echo "diff --check: clean"

# F6: env-gated, GET-only contract check. Reads one calls.get (the
# known-nonexistent probe id by default; a recorded id via
# WARRANTYOPS_CONTRACT_CALL_ID) and validates the payload's shape against
# the adapter's contract. No create path exists; without the live
# environment it refuses offline, exit 1.
contract-live:
	$(PYTHON) -m warrantyops --contract-live

hygiene:
	@if [ -z "$(HYGIENE_AUDIT)" ]; then \
		echo "judge: HYGIENE_AUDIT is not set; supply the path to the hygiene audit tool"; \
		exit 2; \
	fi
	$(PYTHON) $(HYGIENE_AUDIT) --repo $(REPO_ROOT) --staged --history --upstream-limit 0

# F7 static quality. mypy strictness comes from [tool.mypy] in pyproject.toml.
# pip-audit resolves and audits the pinned dev set (closure included) from
# audit-requirements.txt with one documented, accepted advisory; see that
# file's header for the scope rationale and docs/known-limitations.md for the
# environment-level triage.
static:
	$(PYTHON) -m mypy warrantyops
	$(PYTHON) -m ruff check .
	$(PYTHON) -m pip_audit --ignore-vuln PYSEC-2026-1845 -r audit-requirements.txt

# F7 coverage floor: [tool.coverage.report] fail_under = 95, branch = true.
coverage-gate:
	$(PYTHON) -m coverage run -m pytest -q
	$(PYTHON) -m coverage report

# The property suite skips itself when hypothesis is absent; a release gate
# must fail loudly instead of green-skipping.
hypothesis-present:
	@$(PYTHON) -c "import hypothesis" 2>/dev/null || { \
		echo "check: hypothesis is not installed; the property suite would silently skip"; \
		exit 1; \
	}
	@echo "hypothesis: present"

# The shared offline core of both gates.
quality: test validator proof adversarial

check: validator proof adversarial docs scenarios diff-check \
	hypothesis-present coverage-gate static
	@echo "check: all gates green"

judge: quality scenarios diff-check hygiene
	@echo "judge: all gates green"
