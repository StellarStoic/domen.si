#!/usr/bin/env python3
"""Write the feed reader's allow-list from the OPML export.

An open fetcher on a public hostname is a favour to strangers, so the reader is only allowed to
reach hosts D actually subscribes to. The list is generated from the OPML rather than typed: a feed
added to the export is readable after this script runs, and nothing else is.

    python3 scripts/build-feed-hosts.py             # write feeds/hosts.txt
    python3 scripts/build-feed-hosts.py --check     # exit 1 if the file is out of date

The file is deployed to the machine that runs the reader (`/opt/domen-feeds/hosts.txt`).
"""

from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
OPML = ROOT / "assets" / "img" / "data" / "PodcastAddict_OPML_export_20260611_232241.opml"
TARGET = ROOT / "feeds" / "hosts.txt"

HEADER = """# Hosts the domen.si feed reader may fetch — generated, do not edit.
#
# Written by scripts/build-feed-hosts.py from the Podcast Addict OPML export. One host per line,
# lowercase, no scheme and no port. A comment line is allowed and ignored.
#
# Regenerate after the OPML changes, then deploy the file to /opt/domen-feeds/hosts.txt on the box
# that runs the reader and restart the unit.
"""


def hosts_from_opml(path: Path) -> list[str]:
    tree = ET.parse(path)
    hosts: set[str] = set()
    for outline in tree.iter("outline"):
        url = (outline.get("xmlUrl") or "").strip()
        if not url:
            continue
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if host:
            hosts.add(host)
    return sorted(hosts)


def render(hosts: list[str]) -> str:
    body = "\n".join(hosts)
    return f"{HEADER}{body}\n"


def main(argv: list[str]) -> int:
    if not OPML.exists():
        print(f"the OPML export is missing: {OPML}", file=sys.stderr)
        return 1
    hosts = hosts_from_opml(OPML)
    if not hosts:
        print("no xmlUrl values found in the OPML", file=sys.stderr)
        return 1
    produced = render(hosts)
    current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
    if "--check" in argv:
        if produced != current:
            print(f"{TARGET.relative_to(ROOT)} is out of date — run scripts/build-feed-hosts.py", file=sys.stderr)
            return 1
        print(f"{TARGET.relative_to(ROOT)} is up to date ({len(hosts)} hosts)")
        return 0
    if produced == current:
        print(f"{TARGET.relative_to(ROOT)} already lists all {len(hosts)} hosts")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(produced, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)}: {len(hosts)} hosts from {OPML.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
