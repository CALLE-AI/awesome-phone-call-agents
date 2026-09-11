"""Verify an Attest attestation certificate with the PUBLIC key only.

Anyone can run this against a downloaded attestation JSON; no secrets are
involved. The signature covers the canonical JSON (sorted keys, compact
separators) of the document without its signature field.

    uv run --with cryptography python verify_attestation.py attestation.json public-key.pem
"""

from __future__ import annotations

import base64
import json
import pathlib
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.serialization import load_pem_public_key


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("usage: verify_attestation.py <attestation.json> <public-key.pem>")
    doc = json.loads(pathlib.Path(sys.argv[1]).read_text())
    public_key = load_pem_public_key(pathlib.Path(sys.argv[2]).read_bytes())
    signature = doc.pop("signature", None)
    if not signature or not signature.get("signed"):
        sys.exit("UNSIGNED: this document carries no signature to verify")
    canonical = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    try:
        public_key.verify(base64.b64decode(signature["value"]), canonical.encode())
    except InvalidSignature:
        sys.exit("INVALID: the signature does not match this document")
    print("VALID: this attestation was signed by the holder of the matching private key")
    print(f"run: {doc.get('run_id')} verdict: {doc.get('reconciliation', {}).get('verdict')}")


if __name__ == "__main__":
    main()
