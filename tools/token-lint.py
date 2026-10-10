#!/usr/bin/env python3
"""Token ratchet - raw design values outside the token files may only go down.

framework/design-standard.md, "The gates". A front adopting the design standard
late cannot convert every raw value first; this stops drift on the day it is
wired instead. It counts two classes of raw value in the scanned files:

  hex      a colour literal (#abc, #aabbcc, #aabbccdd)
  spacing  a spacing or type declaration with a non-zero number in it
           (padding, margin, gap, inset, font-size, line-height,
           letter-spacing - CSS properties or camelCase style keys)

Files listed under "tokens" are where raw values belong and are never counted.
Comments are stripped first, so a value quoted in a comment is not a finding.

Config: <root>/.token-lint.json
  {
    "tokens":   ["app/globals.css"],
    "scan":     ["app/**/*.css", "components/**/*.tsx"],
    "baseline": {"hex": 1, "spacing": 358}
  }

Exit 0: every count is at or below its baseline.
Exit 1: a count rose above its baseline (or --update-baseline was refused).
Exit 2: the tool could not do its job - no config, a bad pattern, nothing
        matched - and must not be read as a pass.

--update-baseline writes the current counts back, but only when none is above
its baseline: the number only ever falls. With no baseline yet (first wiring)
it records today's counts.
"""
import json
import re
import sys
from pathlib import Path

HEX = re.compile(r"(?<![\w&/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])")
PROPS = r"(?:padding|margin|gap|row-gap|column-gap|inset|font-size|line-height|letter-spacing" \
        r"|padding[A-Z]\w*|margin[A-Z]\w*|rowGap|columnGap|fontSize|lineHeight|letterSpacing)"
CSS_DECL = re.compile(r"(?<![\w-])" + PROPS + r"(?:-[a-z-]+)?\s*:\s*([^;{},\n]+)")
NONZERO = re.compile(r"(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)(?:px|rem|em|pt)?\b")
VAR = re.compile(r"var\([^)]*\)")
CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT = re.compile(r"(?<![:'\"\w])//[^\n]*")


def strip_comments(text, suffix):
    text = CSS_COMMENT.sub("", text)
    if suffix not in (".css", ".scss"):
        text = LINE_COMMENT.sub("", text)
    return text


def count_file(path):
    text = strip_comments(path.read_text(encoding="utf-8", errors="replace"), path.suffix)
    hexes = len(HEX.findall(text))
    spacing = 0
    for value in CSS_DECL.findall(text):
        if NONZERO.search(VAR.sub("", value)):
            spacing += 1
    return hexes, spacing


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    flags = {a for a in argv if a.startswith("--")}
    root = Path(args[0] if args else ".").resolve()
    cfg_path = root / ".token-lint.json"
    if not cfg_path.is_file():
        print(f"token-lint: no config at {cfg_path}", file=sys.stderr)
        return 2
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"token-lint: config is not valid JSON: {e}", file=sys.stderr)
        return 2
    tokens = {(root / t).resolve() for t in cfg.get("tokens", [])}
    files = set()
    for pattern in cfg.get("scan", []):
        for p in root.glob(pattern):
            if p.is_file() and "node_modules" not in p.parts and p.resolve() not in tokens:
                files.add(p)
    if not files:
        print("token-lint: the scan patterns matched no files; refusing to report a pass", file=sys.stderr)
        return 2

    totals = {"hex": 0, "spacing": 0}
    per_file = []
    for p in sorted(files):
        h, s = count_file(p)
        totals["hex"] += h
        totals["spacing"] += s
        if h or s:
            per_file.append((h + s, h, s, p.relative_to(root)))

    baseline = cfg.get("baseline")
    over = [k for k in totals if baseline is not None and totals[k] > baseline.get(k, 0)]

    print(f"token-lint: {len(files)} file(s) scanned under {root.name}/")
    for k in ("hex", "spacing"):
        b = "none" if baseline is None else baseline.get(k, 0)
        mark = "OVER" if k in over else "ok"
        print(f"  {k:<8} {totals[k]:>5}  baseline {b:>5}  {mark}")
    for _, h, s, rel in sorted(per_file, reverse=True)[:5]:
        print(f"    {rel}: hex {h}, spacing {s}")

    if "--update-baseline" in flags:
        if over:
            print("token-lint: refused - a count is above its baseline; the baseline only falls", file=sys.stderr)
            return 1
        cfg["baseline"] = dict(totals)
        cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
        print(f"token-lint: baseline written: hex {totals['hex']}, spacing {totals['spacing']}")
        return 0
    if baseline is None:
        print("token-lint: no baseline recorded; run with --update-baseline once to start the ratchet", file=sys.stderr)
        return 2
    if over:
        print("token-lint: FAILED - raw values grew; use a token, or add one to the token file", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
