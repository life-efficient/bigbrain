#!/usr/bin/env python3
"""Check observed mock-tool traces. This module does not simulate an agent."""

import json
from pathlib import Path
import re
import sys

CASES = Path(__file__).with_name("cases.json")


def load_cases():
    return {case["id"]: case for case in json.loads(CASES.read_text())}


def evaluate(case, trace):
    errors = []
    events = trace.get("events", [])
    expected = case["expect"]
    answer = "\n".join(e.get("text", "") for e in events if e.get("op") == "answer")

    def indices(op, path=None, ok=None):
        return [i for i, e in enumerate(events) if e.get("op") == op
                and (path is None or e.get("path") == path)
                and (ok is None or e.get("ok") is ok)]

    def patterns(text, rules, label):
        for pattern in rules.get("required", []):
            if not re.search(pattern, text, re.I | re.S):
                errors.append(f"{label}: missing {pattern!r}")
        for pattern in rules.get("forbidden", []):
            if re.search(pattern, text, re.I | re.S):
                errors.append(f"{label}: forbidden {pattern!r}")

    if not answer:
        errors.append("missing answer")
    for path in expected.get("reads", []):
        if not indices("read", path, True):
            errors.append(f"missing successful read: {path}")
    for path in expected.get("updated", []):
        if not indices("update", path, True):
            errors.append(f"missing successful update: {path}")
    for path in expected.get("readback", []):
        writes = indices("update", path, True)
        reads = indices("read", path, True)
        if not writes or not any(i > writes[-1] for i in reads):
            errors.append(f"missing read-back: {path}")
    failed = expected.get("failed_update")
    if failed and not indices("update", failed, False):
        errors.append(f"missing failed update attempt: {failed}")
    for op, count in expected.get("counts", {}).items():
        if len(indices(op)) != count:
            errors.append(f"{op}: expected {count}, got {len(indices(op))}")
    ordered = expected.get("ordered", [])
    cursor = -1
    for op in ordered:
        next_indices = [i for i in indices(op) if i > cursor]
        if not next_indices:
            errors.append(f"missing ordered operation: {op}")
            break
        cursor = next_indices[0]
    path = expected.get("read_before_answer")
    if path:
        reads = indices("read", path, True)
        answers = indices("answer")
        if not reads or not answers or reads[0] > answers[0]:
            errors.append(f"answer preceded canonical read: {path}")
    patterns(answer, {"required": expected.get("answer_required", []),
                      "forbidden": expected.get("answer_forbidden", [])}, "answer")
    for path, rules in expected.get("final", {}).items():
        body = trace.get("final_pages", {}).get(path)
        if body is None:
            errors.append(f"missing mock final state: {path}")
            continue
        patterns(body, rules, path)
        for event_id, count in rules.get("event_occurrences", {}).items():
            if body.count(event_id) != count:
                errors.append(f"{path}: {event_id} count must be {count}")
    return errors


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: evaluate.py CASE_ID TRACE.json")
    case = load_cases()[sys.argv[1]]
    errors = evaluate(case, json.loads(Path(sys.argv[2]).read_text()))
    print(json.dumps({"case": case["id"], "passed": not errors, "errors": errors}, indent=2))
    sys.exit(bool(errors))
