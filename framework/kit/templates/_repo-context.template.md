---
repo: <project-name>
front: <front>
path: <path from the portfolio root, or the external registered path>
remote: <git remote url, or N/A>
trust: yours | partnered | employer | stakeholder
tracker: tasks | jira | github
base_branch: <branch to branch FROM, or N/A for non-git projects>
branch_convention: "<house style, e.g. feat/* · fix/*, or N/A>"
write_posture: "<e.g. branch-from-base OK; never add/commit/push unless founder asks>"
build: "<command, or N/A for non-code projects>"
test:  "<command, or N/A>"
run:   "<command, or N/A>"
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

_Up: the front hub `_front.md` (beside this file, or one level up in a housed project) · the portfolio picture `_command/mental-model.md` · the rules `framework/CONSTITUTION.md` from the portfolio root_
