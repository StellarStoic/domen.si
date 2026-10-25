#!/usr/bin/env python3
"""Write interests/builds.json: the BUILDS cube and everything it holds.

Three levels deep, which is what the site already navigates: BUILDS (cube) -> WEB / NOSTR / TELEGRAM /
OTHER (cubes) -> one cube per project, each with a description and, where there is one, a link.

Kept as a script rather than hand-written JSON so the list is one readable table: add a row, run it, the
file is written with the same BOM and two-space indent the other interest files use.
"""

from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "interests" / "builds.json"


def project(pid: str, name: str, description: str, url: str = "") -> dict:
    item = {"id": pid, "name": name, "description": description}
    if url:
        item["url"] = url
    return item


WEB = [
    project("satoshi-si", "SATOSHI.SI", "Bitcoin tools, wallet education and news: BIP39 resources, "
            "price conversion, historical charts, a NIP-05 desk and a Lightning payment service.",
            "https://satoshi.si"),
    project("birds-name", "BIRDS.NAME", "A multilingual bird guide: what a bird is called in each "
            "language, a description from Wikipedia and its conservation status.", "https://birds.name"),
    project("fermentimer", "FERMENTIMER.COM", "A fermentation timer and tracker for kombucha, sourdough, "
            "kimchi, kefir and yogurt: stage timers, notes, history, a calendar.", "https://fermentimer.com"),
    project("pinstr", "PINSTR.SI", "Sign a temporary Nostr note and pin it to a public geohash board: "
            "something that happened, where it happened, paid for in sats.", "https://pinstr.si"),
    project("labelab", "LABELAB.NET", "A private, local label maker: barcodes, QR codes, text labels, "
            "warning signs, laid out on your own paper size.", "https://labelab.net"),
    project("rbgp", "RED BULL GONI PONY", "Results and history of the Red Bull Goni Pony race up Vršič: "
            "every edition, every rider, the times and the stories.", "https://rbgp.051200229.xyz/"),
    project("bau", "BAUHAUS ORDER MERGER", "Merges several Bauhaus PDF purchase orders into one, so every "
            "article appears once with the total quantity across all of them - built for preparing stock "
            "in the warehouse.", "https://bau.051200229.xyz/"),
    project("snofl", "SNOFL.COM", "NostrPostr: write a note and publish it to Nostr from a plain web "
            "page, no client to install.", "https://snofl.com"),
    project("upsy", "UPSY.SI", "A wire watching superintelligence happen: AI articles and podcast "
            "episodes from eighty sources, each with a description you can read before committing an hour.",
            "https://upsy.si"),
    project("shitstr", "SHITSTR.COM", "A poop sound sequencer. It does exactly what the name says.",
            "https://shitstr.com"),
]

NOSTR = [
    project("apod", "APOD", "Astronomy Picture of the Day, posted to Nostr.", 
            "https://ditto.pub/npub1ap0dw55xedm5w4mkcyq8m7xyluwfc680lywrvfe50vr9ckl5m3uqtf5l75"),
    project("scitechdaily", "SCITECHDAILY", "Science and technology news, posted to Nostr.",
            "https://ditto.pub/npub1learnlfye6a5e7dkwyhjqll4nhvlcdqf422axn30yr2yfxnfj90sxrzm08"),
    project("ifeelslovenia", "I FEEL SLOVENIA", "Slovenian things worth seeing, posted to Nostr.",
            "https://ditto.pub/npub1qqqqqqyq8z4j2wpu7dm3hdwu8tsgsmrc2hqvhdufdfhjy6x2yths82mulr"),
    project("ia39bot", "IA39 BOT", "Picks one of the 2048 BIP39 words at random, searches the Internet "
            "Archive for images of that word, and posts what it finds to Nostr. Internet Archive, BIP39.",
            "https://ditto.pub/npub1qqqqq40p2m0uxsuwraplegwph6ceexvnjjacq66j5xy7thpj06msvpc8w3"),
    project("barking-news", "BARKING NEWS", "A Nostr bot that posts news aggregated from various "
            "Telegram news channels.",
            "https://ditto.pub/npub1xnewsxw69t74nlxxsehe4earw47s9t5cqnlh8amy7nevwetuf6ass5efrf"),
    project("neo", "NEO", "Near-Earth objects: what is passing close, posted to Nostr.",
            "https://ditto.pub/npub1qqqqqqz5v99cm58jd4gqk9jn7vvm0xdcfr7waucpgsnugg4ezflqcrdp0u"),
]

TELEGRAM = [
    project("vremenkobot", "VREMENKOBOT", "Weather for Slovenia, in a chat: forecast, radar, warnings.",
            "https://t.me/vremenkobot"),
    project("bitcoinlightninglotterybot", "LIGHTNING LOTTERY", "A lottery settled over Lightning: buy a "
            "ticket in sats and the winning number is a Bitcoin block hash. A lottery impossible to rig.",
            "https://t.me/bitcoinlightninglotterybot"),
    project("trackstrbot", "TRACKSTRBOT", "A Telegram aircraft tracker: give it a plane by its "
            "registration or its ICAO hex address and it follows that airframe.",
            "https://t.me/trackstrbot"),
    project("notamcheckbot", "NOTAMCHECKBOT", "Checks NOTAMs for a flight and says what matters: "
            "closures, restrictions, the lines that actually affect the day.", "https://t.me/notamcheckbot"),
]

OTHER = [
    project("swatcher", "SWATCHER", "Private, watch-only Bitcoin monitoring on StartOS, with a local "
            "Electrs and alerts over NIP-17 or Telegram.", "https://github.com/StellarStoic/swatcher"),
    project("bip39-exotica", "BIP39 EXOTICA", "Generates Bitcoin and Nostr keys from standard and exotic "
            "wordlists: import into apps, build Nostr keys from a mnemonic, recover a key from colours, or "
            "make one out of \"rock, paper, scissors, lizard, spock\".",
            "https://github.com/StellarStoic/BIP39_Exotica"),
    project("bip39-slovenian", "BIP39 SLOVENIAN WORDLIST", "2048 unique Slovenian words, picked and sorted "
            "from the Dictionary of the Slovenian Standard Language, so a seed phrase can live in the "
            "language its owner thinks in. No two words share their first three or four letters - the "
            "uniqueness every BIP-39 wordlist has to keep, so four letters are enough to name a word.",
            "https://github.com/StellarStoic/Slovenian-BIP39-wordlist"),
    project("hermes-tray", "HERMES TRAY", "A tiny PyQt6 tray client for Hermes Agent: streaming replies, a "
            "live tool feed, sessions, and approval prompts as real dialogs.",
            "https://github.com/StellarStoic/hermes-tray"),
]

BUILDS = {
    "id": "builds",
    "name": "BUILDS",
    "description": "Things I made and put on the internet: websites, Nostr accounts that post on their "
                   "own, Telegram bots, and the odd tool that exists because I wanted it. Everything here "
                   "is online now.",
    "visible": True,
    "subInterests": [
        {"id": "builds-web", "name": "WEB", "description": "Sites and web apps, each one live.",
         "visible": True, "subInterests": WEB},
        {"id": "builds-nostr", "name": "NOSTR", "description": "Accounts and bots posting to Nostr - open "
         "the link to see them on a relay reader.", "visible": True, "subInterests": NOSTR},
        {"id": "builds-telegram", "name": "TELEGRAM", "description": "Bots you talk to in Telegram.",
         "visible": True, "subInterests": TELEGRAM},
        {"id": "builds-other", "name": "OTHER", "description": "Tools and data that do not need a server "
         "of their own.", "visible": True, "subInterests": OTHER},
    ],
}


def main() -> int:
    text = json.dumps(BUILDS, indent=4, ensure_ascii=False) + "\n"
    OUT.write_bytes(b"\xef\xbb\xbf" + text.encode("utf-8"))
    counts = ", ".join("%s %d" % (group["name"], len(group["subInterests"]))
                       for group in BUILDS["subInterests"])
    print("wrote %s: %s" % (OUT.relative_to(ROOT), counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
