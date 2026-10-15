#!/usr/bin/env python3
"""The bash twin of tools/check-ignores.ps1: the ignore rules deliver what the docs promise.
The must-ignore and must-track lists are read from check-ignores.ps1 itself, so they stay one
list. Usage: check-ignores.py [root]. Exit 0 clean, 1 with one line per problem."""
import os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(HERE)


def array(name, text):
    m = re.search(r'\$' + name + r'\s*=\s*@\((.*?)\n\)', text, re.S)
    if not m:
        sys.exit(f'check-ignores: no ${name} list in check-ignores.ps1')
    return re.findall(r'^\s*"([^"]+)"', m.group(1), re.M)


def ignored(path):
    # check-ignore -v reports negations too, so decide on the pattern text: a last match
    # starting with "!" means NOT ignored. Exit 0 = a pattern matched, 1 = none, >1 = git failed.
    r = subprocess.run(['git', '-C', ROOT, 'check-ignore', '-v', '--no-index', '--', path], capture_output=True, text=True)
    if r.returncode > 1:
        sys.exit(f"check-ignores: git check-ignore could not evaluate '{path}' under '{ROOT}': {r.stderr.strip()}")
    if not r.stdout:
        return False
    pattern = re.sub(r'^.*?:\d+:', '', r.stdout.splitlines()[0].split('\t')[0])
    return not pattern.startswith('!')


def main():
    with open(os.path.join(HERE, 'check-ignores.ps1'), encoding='utf-8') as fh:
        ps1 = fh.read()
    must_ignore, must_track = array('mustIgnore', ps1), array('mustTrack', ps1)
    failures = [f'NOT IGNORED but must be: {p}' for p in must_ignore if not ignored(p)]
    failures += [f'IGNORED but must stay trackable: {p}' for p in must_track if ignored(p)]
    tracked = subprocess.run(['git', '-c', 'core.quotePath=false', '-C', ROOT, 'ls-files'], capture_output=True, text=True, check=True).stdout.splitlines()
    # A tracked file the rules would ignore stays tracked here (the index wins) but is lost by a clone that re-adds it.
    failures += [f'TRACKED but the rules would ignore it: {p}' for p in tracked if ignored(p)]
    for f in failures:
        print(f)
    if failures:
        print(f'CHECK-IGNORES FAILED: {len(failures)} problem(s).')
        sys.exit(1)
    print(f'CHECK-IGNORES CLEAN: {len(must_ignore)} must-ignore, {len(must_track)} must-track, {len(tracked)} tracked file(s) verified.')


if __name__ == '__main__':
    main()
