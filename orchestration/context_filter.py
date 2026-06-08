from __future__ import annotations

import re


PHYSICAL_NOUNS = {
    "anchor",
    "anchors",
    "bracket",
    "brackets",
    "drywall",
    "screw",
    "screws",
    "truck",
    "trucks",
    "wire",
    "wires",
    "sensor",
    "sensors",
    "device",
    "devices",
}

ABSTRACTION_MAP = {
    "blocked": "dissolving perceived limitation through mind power",
    "stuck": "dissolving perceived limitation through mind power",
    "delay": "overcoming delay through decisive belief",
    "late": "overcoming delay through decisive belief",
    "failed": "transforming failure into constructive expectation",
    "failure": "transforming failure into constructive expectation",
    "conflict": "harmonizing divided intention into focused action",
    "stress": "restoring calm authority under pressure",
}


def transform_operational_query(text: str) -> str:
    tokens = re.findall(r"[a-zA-Z0-9_'-]+", text.lower())
    filtered = [token for token in tokens if token not in PHYSICAL_NOUNS]

    for token in filtered:
        if token in ABSTRACTION_MAP:
            return ABSTRACTION_MAP[token]

    if not filtered:
        return "dissolving physical limitations through mind power"

    return " ".join(filtered)
