#!/usr/bin/env python3
"""Mirror the Nostr NIPs repository and turn it into the data the NIPS cell reads.

Two sources, both cloned into /opt/data/nostr-knowledge on this box:

    nips/               https://github.com/nostr-protocol/nips
    registry-of-kinds/  https://github.com/nostr-protocol/registry-of-kinds

What this writes into the domen.si repository:

    nips/*.md               the upstream markdown, byte for byte, so the mirror is the text itself
    data/nips.json          the index: every NIP with its title, status and the kinds it defines,
                            plus every kind with the NIP that defines it, and the upstream commit
    data/nips/pages/*.html  one rendered page per NIP, produced from the mirrored markdown

The page is static and has no markdown renderer, so rendering happens here — but always from the
mirrored file, never from a second fetch, so the HTML and the markdown cannot disagree.

Idempotent: a run where upstream has not moved rewrites nothing and says so. Run it with --check to
get the same answer as an exit code (1 = the checkout is stale), which is what a scheduled job wants.

    python3 scripts/build-nips.py            # mirror, render, write
    python3 scripts/build-nips.py --check    # exit 1 if the repository no longer matches upstream
    python3 scripts/build-nips.py --offline  # skip the git fetch, rebuild from what is on disk
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import markdown

REPO = Path(__file__).resolve().parent.parent
MIRROR = Path("/opt/data/nostr-knowledge/nips")
REGISTRY = Path("/opt/data/nostr-knowledge/registry-of-kinds")
SITE_COPY = REPO / "nips"
INDEX = REPO / "data" / "nips.json"
PAGES = REPO / "data" / "nips" / "pages"

# NIPs are numbered 01..99 plus the newer two-character ones, which are either letter-first (A0, B7, C7,
# F4, EE) or digit-first (5A, 7D). A file whose name is not exactly two characters is documentation.
NIP_FILE = re.compile(r"^([0-9]{2}|[0-9A-Z]{2})\.md$")


def git(*args, cwd=None, timeout=180):
    result = subprocess.run(["git", *args], cwd=str(cwd or MIRROR), capture_output=True, text=True,
                            timeout=timeout)
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def refresh_mirror(offline):
    """Fetch upstream. A failure is reported, not fatal: the existing clone is still usable."""
    if offline:
        return "offline: not fetched"
    if not (MIRROR / ".git").exists():
        return "no clone at %s — run git clone https://github.com/nostr-protocol/nips" % MIRROR
    before = git("rev-parse", "HEAD")[1].strip()
    code, out = git("fetch", "--quiet", "origin")
    if code != 0:
        return "fetch failed (%s); mirror left at %s" % (out.strip().splitlines()[-1][:80], before[:7])
    code, out = git("merge", "--ff-only", "--quiet", "origin/HEAD")
    after = git("rev-parse", "HEAD")[1].strip()
    if after == before:
        return "already at %s" % after[:7]
    return "moved %s -> %s" % (before[:7], after[:7])


def nip_title_and_status(text):
    """The title is the underline heading under the NIP number; the status is the backticked words."""
    lines = text.splitlines()
    title = ""
    for index, line in enumerate(lines[:12]):
        if set(line.strip()) == {"-"} and line.strip():
            if index > 0 and lines[index - 1].strip():
                title = lines[index - 1].strip()
                break
    status = []
    for line in lines[:20]:
        stripped = line.strip()
        if stripped.startswith("`") and stripped.endswith("`"):
            status = [word.strip("`") for word in stripped.split()]
            break
    return title, status


def nip_note(text):
    """The first real paragraph, for the list and the heading.

    The head of every NIP file is a title, a row of dashes under it, and the status words — none of which
    is a summary. Taking "the first block that is long enough" picked up the title with its underline still
    attached, which the cell then printed under the heading it was already showing.
    """
    title, _status = nip_title_and_status(text)
    for block in text.split("\n\n")[1:]:
        lines = [line for line in block.strip().splitlines()
                 if line.strip() and not set(line.strip()) <= set("=-")]
        plain = " ".join(lines).strip()
        if not plain or plain.startswith("`"):
            continue
        plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", plain)
        plain = re.sub(r"[*_`#>]", "", plain)
        plain = re.sub(r"\s+", " ", plain).strip()
        if plain == title or len(plain) < 40:
            continue
        return (plain[:197] + "…") if len(plain) > 200 else plain
    return ""


def parse_kinds(readme):
    """The kinds table: | `0` | User Metadata | [01](01.md) |. Ranges are kept as written.

    Only the "Event Kinds" section is read. The README also tabulates client-to-relay *messages* in the
    same shape — a row whose first cell is OK or CLOSE, pointing at NIP-01 — and a parser that walks
    every table collects those as kinds. NIP-01 came out owning "OK" and "CLOSE" before this.
    """
    start = readme.find("## Event Kinds")
    if start < 0:
        return []
    end = readme.find("\n## ", start + 1)
    section = readme[start:end if end > 0 else len(readme)]
    kinds = []
    for line in section.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        number = cells[0].strip("` ")
        if not number:
            continue
        first = number.split("-")[0].split(",")[0].strip()
        if not first.isdigit():
            continue
        link = re.search(r"\(([A-Za-z0-9]+)\.md\)", cells[2])
        if not link:
            continue
        kinds.append({
            "kind": number,
            "title": re.sub(r"[*_`]", "", cells[1]),
            "nip": link.group(1),
        })
    # one entry per number, the table repeats some rows across sections
    seen = {}
    for row in kinds:
        seen.setdefault(row["kind"], row)
    return sorted(seen.values(), key=lambda row: (len(row["kind"]), row["kind"]))


def kind_numbers_for(nip_slug, kinds):
    """Which kinds this NIP defines, read off the table rather than guessed from the text."""
    numbers = []
    for row in kinds:
        if row["nip"].lower() == nip_slug.lower():
            numbers.append(row["kind"])
    return numbers


def render(text, slug, commit):
    """Markdown to the HTML the cell draws, with three rewrites for a page that is not a markdown site.

    - `href="22.md"` becomes `data-nip="22"`: a NIP citing its neighbour should open it in the cell, not
      fetch a markdown file the browser would download.
    - absolute links open away from the page, with `rel` set, since the source is someone else's text.
    - relative images are not mirrored, so they point at the upstream repository at the mirrored commit.
    """
    body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list"],
        output_format="html",
    )
    body = re.sub(r'href="([0-9A-Za-z]{2,4})\.md(?:#[^"]*)?"',
                  lambda m: 'href="#" data-nip="%s"' % m.group(1), body)
    body = re.sub(r'<a href="(https?://[^"]+)"(?![^>]*\brel=)',
                  r'<a href="\1" target="_blank" rel="noopener noreferrer"', body)
    # The cell draws its own heading, status line and kind chips, so the document's own first heading,
    # title and status paragraph would print twice. Drop exactly those three from the top.
    body = re.sub(r'^\s*<h1>[^<]*</h1>\s*', "", body, count=1)
    body = re.sub(r'^\s*<h2>[^<]*</h2>\s*', "", body, count=1)
    body = re.sub(r'^\s*<p>(?:<code>[^<]*</code>\s*)+</p>\s*', "", body, count=1)
    body = re.sub(
        r'<img([^>]*?)src="(?!https?:)([^"]+)"',
        lambda m: '<img%ssrc="https://raw.githubusercontent.com/nostr-protocol/nips/%s/%s"'
                  % (m.group(1), commit, m.group(2).lstrip("./")),
        body,
    )
    return '<article class="nips-doc" id="nip-%s">\n%s\n</article>\n' % (slug, body)


def write_if_changed(path, content, changed):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.write_text(content, encoding="utf-8")
    changed.append(str(path.relative_to(REPO)))
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="exit 1 when the checkout is stale")
    parser.add_argument("--offline", action="store_true", help="do not fetch upstream")
    args = parser.parse_args()

    if not MIRROR.exists():
        sys.exit("the NIPs mirror is missing: git clone https://github.com/nostr-protocol/nips %s" % MIRROR)

    mirror_note = refresh_mirror(args.offline)
    commit = git("rev-parse", "HEAD")[1].strip()
    commit_date = git("show", "-s", "--format=%cI", "HEAD")[1].strip()
    readme = (MIRROR / "README.md").read_text(encoding="utf-8")
    kinds = parse_kinds(readme)

    changed = []
    nips = []
    for path in sorted(MIRROR.glob("*.md")):
        match = NIP_FILE.match(path.name)
        if not match:
            continue
        slug = match.group(1)
        text = path.read_text(encoding="utf-8")
        title, status = nip_title_and_status(text)
        nips.append({
            "nip": slug,
            "title": title,
            "status": status,
            "note": nip_note(text),
            "kinds": kind_numbers_for(slug, kinds),
            "file": path.name,
        })
        write_if_changed(PAGES / ("%s.html" % slug.lower()), render(text, slug, commit), changed)
        # the markdown itself is mirrored, byte for byte, so the text can be checked against upstream
        shutil.copyfile(path, str(SITE_COPY / path.name)) if SITE_COPY.exists() else None

    # the markdown mirror and the README travel with the site
    SITE_COPY.mkdir(exist_ok=True)
    for path in sorted(MIRROR.glob("*.md")):
        target = SITE_COPY / path.name
        if not target.exists() or target.read_bytes() != path.read_bytes():
            target.write_bytes(path.read_bytes())
            changed.append(str(target.relative_to(REPO)))

    nips.sort(key=lambda row: (len(row["nip"]), row["nip"]))
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "upstream": {
            "repo": "https://github.com/nostr-protocol/nips",
            "commit": commit,
            "committedAt": commit_date,
            "mirror": mirror_note,
        },
        "counts": {"nips": len(nips), "kinds": len(kinds)},
        "nips": nips,
        "kinds": kinds,
    }
    write_if_changed(INDEX, json.dumps(payload, indent=2, ensure_ascii=False) + "\n", changed)

    # pages for NIPs that no longer exist upstream should not linger and be reachable
    live = {"%s.html" % row["nip"].lower() for row in nips}
    for page in PAGES.glob("*.html"):
        if page.name not in live:
            page.unlink()
            changed.append(str(page.relative_to(REPO)))

    stale = [entry for entry in changed if entry.startswith("data/") or entry.startswith("nips/")]
    print("upstream: %s at %s (%s)" % (mirror_note, commit[:7], commit_date))
    print("read: %d NIPs, %d kinds" % (len(nips), len(kinds)))
    if stale:
        print("rewrote %d file(s):" % len(stale))
        for entry in stale[:12]:
            print("  ", entry)
        if len(stale) > 12:
            print("   … and %d more" % (len(stale) - 12))
    else:
        print("nothing to rewrite: the checkout already matches upstream")
    if args.check and stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
