#!/usr/bin/env python3
"""Check the proving-key size model against every generated snarkjs zkey.

Model (snarkjs Groth16 zkey layout, BN254, uncompressed affine points):
    size = fixed + 64*(nPublic+1)            # IC points (section 3)
                 + 4 + 44*nCoefs             # coefficient section (section 4)
                 + 64*nVars + 64*nVars       # A and B1 queries in G1 (sections 5, 6)
                 + 128*nVars                 # B2 query in G2 (section 7)
                 + 64*(nVars - nPublic - 1)  # C query, private wires only (section 8)
                 + 64*domainSize             # H query (section 9)
Only section headers are read; section bodies are skipped with seek().

Usage: python3 -I analysis/zkey_size_model.py <configurations-dir> [<output.md>]
"""
import os
import struct
import sys
from pathlib import Path


def read_sections(path: Path):
    with path.open("rb") as f:
        if f.read(4) != b"zkey":
            raise ValueError(f"{path}: not a zkey file")
        _version, n_sections = struct.unpack("<II", f.read(8))
        sections = {}
        for _ in range(n_sections):
            section_type, size = struct.unpack("<IQ", f.read(12))
            start = f.tell()
            sections.setdefault(section_type, []).append((start, size))
            f.seek(start + size)
        # Groth16 header (section 2): n8q, q, n8r, r, nVars, nPublic, domainSize, ...
        start, _ = sections[2][0]
        f.seek(start)
        (n8q,) = struct.unpack("<I", f.read(4))
        f.seek(n8q, os.SEEK_CUR)
        (n8r,) = struct.unpack("<I", f.read(4))
        f.seek(n8r, os.SEEK_CUR)
        n_vars, n_public, domain_size = struct.unpack("<III", f.read(12))
        # Coefficient count (section 4)
        start, _ = sections[4][0]
        f.seek(start)
        (n_coefs,) = struct.unpack("<I", f.read(4))
    sizes = {k: sum(s for _, s in v) for k, v in sections.items()}
    return {
        "file_bytes": path.stat().st_size,
        "n_vars": n_vars,
        "n_public": n_public,
        "domain_size": domain_size,
        "n_coefs": n_coefs,
        "section_bytes": sizes,
    }


def predicted_variable_part(info) -> int:
    v, p, n, q = info["n_vars"], info["n_public"], info["domain_size"], info["n_coefs"]
    return (64 * (p + 1) + 4 + 44 * q + 64 * v + 64 * v + 128 * v
            + 64 * (v - p - 1) + 64 * n)


def main() -> None:
    root = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    rows = []
    for zkey in sorted(root.glob("*/*/*_final.zkey")):
        config, mode = zkey.parent.parent.name, zkey.parent.name
        info = read_sections(zkey)
        variable = predicted_variable_part(info)
        rows.append((config, mode, info, info["file_bytes"] - variable))
    fixed_values = sorted({r[3] for r in rows})
    lines = [
        "# Proving-key size model check",
        "",
        "Each row is one generated zkey. `fixed` = file size minus the size predicted from",
        "nVars, nPublic, nCoefs and domainSize (see the script docstring). A single constant",
        "`fixed` across all keys means the model accounts for every variable byte.",
        "",
        "| Config | Circuit | nVars | nPublic | nCoefs | Domain | File bytes | Fixed bytes |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for config, mode, info, fixed in rows:
        lines.append(
            f"| {config} | {mode} | {info['n_vars']} | {info['n_public']} | {info['n_coefs']} | "
            f"{info['domain_size']} | {info['file_bytes']:,} | {fixed:,} |")
    lines += ["", f"Distinct fixed-part values: {', '.join(f'{v:,}' for v in fixed_values)}", ""]
    text = "\n".join(lines)
    print(text)
    if out:
        out.write_text(text)


if __name__ == "__main__":
    main()
