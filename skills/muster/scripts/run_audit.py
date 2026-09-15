#!/usr/bin/env python3
"""
Portable standalone audit runner script for the Muster Agent Skill.
Compatible with the awesome-phone-call-agents repository structure.
Usage:
  python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json --mode mock
  python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json --sector US_INSURER --mode live
"""

import sys
from pathlib import Path

# Dynamically locate repository root containing the 'muster' package
search_dir = Path(__file__).resolve().parent
while search_dir != search_dir.parent:
    if (search_dir / "muster" / "__init__.py").exists():
        if str(search_dir) not in sys.path:
            sys.path.insert(0, str(search_dir))
        break
    search_dir = search_dir.parent

from muster.cli import main

if __name__ == "__main__":
    # If the user passes a file directly without the 'audit' subcommand, auto-insert 'audit'
    if len(sys.argv) > 1 and sys.argv[1] not in ["audit", "ui", "-h", "--help"]:
        sys.argv.insert(1, "audit")
    main()
