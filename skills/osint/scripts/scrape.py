#!/usr/bin/env python3
"""Fetch and extract a public page with Scrapling, for pages a plain fetch
cannot read. Open sources only; the skill's scope and robots rules still apply.

  scrape.py <url>                 fetch, print readable text (+ links with --links)
  scrape.py <url> --stealth       use the stealthy fetcher (sites that block bots)
  scrape.py <url> --css '<sel>'   print text of matching elements
  scrape.py <url> --links         also list on-page links

Run with the skill's venv python (scripts/.venv/bin/python), set up by
install-osint.sh.
"""
import argparse, sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--stealth", action="store_true")
    ap.add_argument("--css")
    ap.add_argument("--links", action="store_true")
    ap.add_argument("--max", type=int, default=6000, help="max chars of text to print")
    a = ap.parse_args()
    try:
        from scrapling.fetchers import Fetcher, StealthyFetcher
    except ImportError as e:
        print(f"scrapling fetchers unavailable ({e}). Run scripts/install-osint.sh.", file=sys.stderr)
        return 3

    try:
        if a.stealth:
            page = StealthyFetcher.fetch(a.url, headless=True, network_idle=True)
        else:
            page = Fetcher.get(a.url, stealthy_headers=True, follow_redirects=True)
    except Exception as e:  # noqa: BLE001 - report any fetch failure plainly
        print(f"fetch failed: {e}", file=sys.stderr)
        return 1

    status = getattr(page, "status", "?")
    print(f"# {a.url}  (status {status})\n")
    if a.css:
        for el in page.css(a.css):
            text = el.get_all_text(strip=True) if hasattr(el, "get_all_text") else el.text
            if text:
                print(text)
        return 0

    text = page.get_all_text(strip=True)
    print(text[: a.max] + (" ...[truncated]" if len(text) > a.max else ""))
    if a.links:
        print("\n## links")
        seen = set()
        for href in page.css("a::attr(href)"):
            h = str(href)
            if h.startswith("http") and h not in seen:
                seen.add(h)
                print(h)
                if len(seen) >= 100:
                    break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
