#!/usr/bin/env python3
"""Assemble the immunisation-day board from JSON written by client.py --out.

  python3 board.py --roster roster.json [--doctor doctor.json] [--preflight preflight.json] -o board.html
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaxcheck.board import render_file  # noqa: E402

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("--roster", required=True); p.add_argument("--doctor"); p.add_argument("--preflight"); p.add_argument("-o", "--out", required=True)
a = p.parse_args()
render_file(a.roster, a.out, a.doctor, a.preflight); print(f"wrote {a.out}")
