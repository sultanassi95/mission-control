#!/usr/bin/env python3
"""Reference check for the Markdown docs: every repo path a doc names, and every
relative link, must resolve. The bash twin of tools/check-refs.ps1, widened to tools/
paths and relative Markdown links. Usage: check-refs.py [path ...] (files or folders;
default: every tracked .md). Exit 0 clean, 1 with file:line per broken reference."""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH_REF = re.compile(r'(?<![\w/.-])((?:framework|\.claude/skills|kit|tools)/[A-Za-z0-9_./-]+\.(?:md|ps1|sh|py|mjs|ts|json|template|html|css|js|txt))')
LINK = re.compile(r'\]\(([^)\s]+)\)')
PLACEHOLDER = re.compile(r'[<>*{}$]')


def targets(args):
    if not args:
        out = subprocess.run(['git', '-C', ROOT, 'ls-files', '*.md'], capture_output=True, text=True, check=True).stdout
        return [os.path.join(ROOT, p) for p in out.split() if not p.startswith('node_modules/')]
    files = []
    for a in args:
        p = a if os.path.isabs(a) else os.path.join(os.getcwd(), a)
        if os.path.isdir(p):
            for d, _, names in os.walk(p):
                if 'node_modules' in d:
                    continue
                files += [os.path.join(d, n) for n in names if n.endswith('.md')]
        elif os.path.exists(p):
            files.append(p)
        else:
            print(f'check-refs: no such path {a}', file=sys.stderr)
            sys.exit(2)
    return files


def ignored(path):
    # A path the repo deliberately does not ship (gitignored) counts as resolved.
    rel = os.path.relpath(path, ROOT)
    return not rel.startswith('..') and subprocess.run(['git', '-C', ROOT, 'check-ignore', '-q', rel]).returncode == 0


def resolves(ref, here):
    ref = ref.split('#', 1)[0]
    if not ref:
        return True
    candidates = [os.path.join(ROOT, ref), os.path.join(here, ref)]
    if ref.startswith('kit/'):
        candidates.append(os.path.join(ROOT, 'framework', ref))
    return any(os.path.exists(c) for c in candidates) or ignored(candidates[0])


def main():
    broken, checked = [], 0
    for f in sorted(set(targets(sys.argv[1:]))):
        here = os.path.dirname(f)
        rel = os.path.relpath(f, ROOT)
        # Instance templates link to where they will live once copied; their links are not followed.
        follow_links = not rel.startswith('framework/kit/templates/')
        fenced = False
        with open(f, encoding='utf-8', errors='replace') as fh:
            for n, line in enumerate(fh, 1):
                if line.lstrip().startswith('```'):
                    fenced = not fenced
                    continue
                refs = [m.group(1) for m in PATH_REF.finditer(line)]
                # A link written inside code (a fence or an inline span) is an example, not a link.
                prose = re.sub(r'`[^`]*`', '', line)
                if follow_links and not fenced:
                    refs += [m.group(1) for m in LINK.finditer(prose) if not re.match(r'^(https?:|mailto:|#)', m.group(1))]
                for ref in refs:
                    if PLACEHOLDER.search(ref):
                        continue
                    checked += 1
                    if not resolves(ref, here):
                        broken.append(f'{rel}:{n}: {ref}')
    for b in sorted(set(broken)):
        print(b)
    if broken:
        print(f'CHECK-REFS FAILED: {len(set(broken))} broken reference(s), {checked} checked.')
        sys.exit(1)
    print(f'CHECK-REFS CLEAN: {checked} references checked, all resolve.')


if __name__ == '__main__':
    main()
