.DEFAULT_GOAL := help

UV ?= uv
PYTHON ?= .venv/bin/python
RUFF_VERSION ?= 0.16.5
RUFF := $(UV) run --no-project --with ruff==$(RUFF_VERSION) ruff

.PHONY: help format format-check lint test check run

help: ## Show the available engine commands.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

format: ## Fix lint/import-order issues, then format Python files.
	$(RUFF) check --fix .
	$(RUFF) format .

format-check: ## Check formatting without changing files.
	$(RUFF) format --check .

lint: ## Check lint rules and import ordering without changing files.
	$(RUFF) check .

test: ## Run the complete engine test suite without writing a pytest cache.
	$(PYTHON) -m pytest -p no:cacheprovider

check: format-check lint test ## Run every non-mutating CI check.

run: ## Start the local engine on port 8008.
	$(PYTHON) -m uvicorn main:app --reload --port 8008
