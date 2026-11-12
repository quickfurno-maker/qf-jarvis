"""Read-only eligibility gate for Anisha English/Hinglish local-training corpus.

Inputs stay untouched. No training, inference, network request or production activation.
This is a structural/metadata guard, not a semantic language or policy quality audit.
"""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import gzip
import hashlib
import json
import re
import sys

ALLOWED_LANGUAGES = {"ENGLISH", "HINGLISH"}
DEVANAGARI = re.compile(r"[\u0900-\u097F]")
SPLITS = ("train", "validation", "boundary_eval")


def digest(data_path: Path, compress: bool) -> str:
    h = hashlib.sha256()
    opener = open if compress else gzip.open
    with opener(data_path, "rb") as stream:
        while piece := stream.read(1024 * 1024):
            h.update(piece)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True, help="Directory containing manifest.json and anisha/ split files")
    args = parser.parse_args()
    bundle: Path = args.bundle
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    expected = manifest["agents"]["ANISHA"]
    seen_ids: set[str] = set()
    report: dict[str, object] = {}
    failures: list[str] = []

    for split in SPLITS:
        target = bundle / "anisha" / f"{split.replace('_', '-')}.jsonl.gz"
        # Historical bundle uses boundary-eval.jsonl.gz, train.jsonl.gz and validation.jsonl.gz.
        expected_split = expected[split]
        row_languages: Counter[str] = Counter()
        assistant_turns = 0
        devanagari_turns = 0
        rows = 0
        with gzip.open(target, "rt", encoding="utf-8") as stream:
            for row_no, line in enumerate(stream, start=1):
                rows += 1
                value = json.loads(line)
                language = str(value.get("metadata", {}).get("language", "<missing>"))
                row_languages[language] += 1
                if language not in ALLOWED_LANGUAGES:
                    failures.append(f"{split}: unexpected language on row {row_no}: {language}")
                row_id = value.get("id")
                if not isinstance(row_id, str) or not row_id:
                    failures.append(f"{split}: missing ID on row {row_no}")
                elif row_id in seen_ids:
                    failures.append(f"{split}: duplicate ID on row {row_no}")
                else:
                    seen_ids.add(row_id)
                if value.get("agent") != "ANISHA":
                    failures.append(f"{split}: non-Anisha entry on row {row_no}")
                for msg in value.get("messages", []):
                    if msg.get("role") == "assistant":
                        assistant_turns += 1
                        content = msg.get("content")
                        if not isinstance(content, str) or DEVANAGARI.search(content):
                            devanagari_turns += 1
        if rows != expected_split["rows"]:
            failures.append(f"{split}: row count mismatch {rows}")
        if digest(target, True) != expected_split["gzip_sha256"]:
            failures.append(f"{split}: compressed checksum mismatch")
        if digest(target, False) != expected_split["raw_sha256"]:
            failures.append(f"{split}: decompressed checksum mismatch")
        report[split] = {
            "rows": rows,
            "languages": dict(row_languages),
            "assistant_turns": assistant_turns,
            "assistant_nonroman_or_invalid_turns": devanagari_turns,
            "compressed_and_raw_checksums": "verified",
        }
        if devanagari_turns:
            failures.append(f"{split}: {devanagari_turns} non-Roman/invalid assistant turns")
    print(json.dumps({"status": "PASS" if not failures else "FAIL",
                      "note": "Roman-script and metadata gate only; Hinglish semantic quality requires further review.",
                      "report": report, "failures": failures[:15],
                      "failure_count": len(failures)}, indent=2))
    return int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
