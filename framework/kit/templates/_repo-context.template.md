---
repo: <repo-name>
front: <front>
path: <path relative to work/>
remote: <git remote url>
trust: personal | partnered | stakeholder | employer
base_branch: <branch to branch FROM>
branch_convention: "<house style, e.g. feat/* · fix/*>"
write_posture: "<e.g. branch-from-base OK; never add/commit/push unless founder asks>"
build: "<command>"
test:  "<command>"
run:   "<command>"
key_dirs: "<optional>"
gotchas: "<optional>"
---

# <repo> - repo context (spoke)

> One paragraph: what this repo is and its role in the front. This file is the unit handed to a sub-agent - it must let a zero-context agent act competently.

## Layout / where things live
<key directories, entry points>

## How to work in it
<build/test/run notes a sub-agent needs>

## Depends on / Depended on by (mapped fronts only)
- Depends on: <counterparts, one line> - detail in [_map.md](../_map.md)
- Depended on by: <N> inbound - check `_map.md` before changing contracts

_Front: [_front](./_front.md) · Up: [mental-model](../../mental-model.md) · Rules: [CONSTITUTION](../../CONSTITUTION.md)_
