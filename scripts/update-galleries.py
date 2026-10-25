#!/usr/bin/env python3
"""Write each gallery's file list into the interest JSON, from the folders on disk.

GitHub Pages serves no directory listing. A gallery that discovers its own photos at runtime asks for
`assets/img/nature/`, gets a 404, parses nothing, and shows an empty panel - which is why NATURE and
PARAGLIDING had no pictures on the live site even though the folders hold 85 and 10 photographs.

So the list lives in the JSON. This script keeps it true: drop photos into a folder, run
`python3 scripts/update-galleries.py`, commit. It touches nothing else - the surrounding formatting is
preserved, so the diff is the list and only the list.

    python3 scripts/update-galleries.py          # rewrite the lists
    python3 scripts/update-galleries.py --check  # exit 1 if any list is out of date
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INTERESTS = ROOT / "interests"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}
PER_LINE = 4

PATH_LINE = re.compile(r'(?m)^(\s*)"path":\s*"([^"]+)"')
FILES_BLOCK = re.compile(r'(?m)^\s*"files":\s*\[[^\]]*\]\s*,?\s*\n')


def photos(folder: pathlib.Path) -> list[str]:
    """Every image in the folder, ordered by the number in its name."""
    if not folder.is_dir():
        return []
    names = [entry.name for entry in folder.iterdir()
             if entry.is_file() and entry.suffix.lower() in IMAGE_SUFFIXES]
    return sorted(names, key=lambda name: (int(re.findall(r"\d+", name)[0]) if re.findall(r"\d+", name) else 0,
                                           name.lower()))


def as_json_array(names: list[str], indent: str) -> str:
    if not names:
        return f'{indent}"files": [],\n'
    lines = []
    for start in range(0, len(names), PER_LINE):
        chunk = ", ".join('"%s"' % name for name in names[start:start + PER_LINE])
        lines.append(chunk)
    joined = (",\n" + indent + " " * 4).join(lines)
    return f'{indent}"files": [\n{indent}    {joined}\n{indent}],\n'


CLOSE_BRACE = re.compile(r"(?m)^[ \t]*\}[ \t]*$")


def update(path: pathlib.Path, check: bool) -> list[str]:
    # The interest files carry a UTF-8 BOM: stripping it changes nothing a browser sees, and keeping it
    # means the diff is the file list rather than the whole file.
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    original = text
    changes: list[str] = []

    for match in reversed(list(PATH_LINE.finditer(text))):
        folder_relative = match.group(2).strip()
        if not folder_relative.startswith("assets/img"):
            continue
        names = photos(ROOT / folder_relative)
        if not names:
            continue
        rest = text[match.end():]
        # Only this gallery object counts: the rest of the file holds other galleries, and rewriting one
        # of those while working on this one is how the paragliding list disappeared once already.
        close = CLOSE_BRACE.search(rest)
        block, after = (rest[:close.start()], rest[close.start():]) if close else (rest, "")
        alt = re.search(r'(?m)^([ \t]*)"alt":', block)
        indent = alt.group(1) if alt else match.group(1) + " " * 4
        had_list = bool(FILES_BLOCK.search(block))
        block = re.sub(r"^[ \t]*,[ \t]*\n", "\n", block)      # the comma that followed the path value
        block = FILES_BLOCK.sub("", block, count=1)               # an old list, if there was one
        array = as_json_array(names, indent)
        candidate = text[:match.end()] + ",\n" + array + block.lstrip("\n") + after
        if candidate == text:
            continue                      # already correct: --check must stay quiet and the write idle
        text = candidate
        changes.append("%s: %d file(s)%s" % (folder_relative, len(names), " (updated)" if had_list else ""))

    if not changes:
        return []
    if not check:
        json.loads(text)          # never write a file that does not parse
        path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report what is out of date, change nothing")
    args = parser.parse_args()
    stale = 0
    for path in sorted(INTERESTS.glob("*.json")):
        changes = update(path, args.check)
        for change in changes:
            stale += 1
            print(f"{'stale' if args.check else 'wrote'} {path.name}: {change}")
    if args.check and stale:
        print("gallery lists are out of date; run scripts/update-galleries.py")
        return 1
    if not stale:
        print("every gallery list matches its folder")
    return 0


if __name__ == "__main__":
    sys.exit(main())
