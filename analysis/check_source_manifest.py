#!/usr/bin/env python3
"""Check that the sources in a repository are the ones recorded with a run.

Usage: python3 -I analysis/check_source_manifest.py <environment.json> [<repository-root>] [--strict]

Each experiment directory holds environment-<ms>.json, written when the run started. Its
sourceManifest maps every circuit, contract, library and runner file, and every generated
verifier contract, to its SHA-256. This script reports for each entry whether the file under
<repository-root> (default: the current directory) is identical, different or missing.

The generated verifiers (contracts/contracts/cmc_verifiers/) exist only after the circuits are
built or the artifacts archive is extracted. Missing files are reported; they fail the check
only with --strict. Any differing file fails it.
"""
import hashlib
import json
import sys
from pathlib import Path


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--strict"]
    strict = "--strict" in sys.argv[1:]
    if not 1 <= len(args) <= 2:
        sys.exit(__doc__)
    manifest = json.loads(Path(args[0]).read_text())["sourceManifest"]
    root = Path(args[1]) if len(args) == 2 else Path(".")
    counts = {"identical": 0, "different": 0, "missing": 0}
    for name, expected in sorted(manifest.items()):
        path = root / name
        if not path.is_file():
            status = "missing"
        elif hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            status = "identical"
        else:
            status = "different"
        counts[status] += 1
        if status != "identical":
            print(f"{status:9}  {name}")
    print(f"{len(manifest)} files: {counts['identical']} identical, {counts['different']} different, "
          f"{counts['missing']} missing")
    sys.exit(1 if counts["different"] or (strict and counts["missing"]) else 0)


if __name__ == "__main__":
    main()
