#!/usr/bin/env python3
"""Every front's folder under fronts/ holds that front's repositories, fronts/<front>/<repo>.
Reports a front folder that is itself a git repository (a .git entry, or a bare repository),
and a git worktree at the top of fronts/ instead of inside its front's folder (also one whose
repository has moved), each with the commands that fix it, run from the root. Reads only;
moves nothing.
Usage: check-fronts.py [root]. Exit 0 clean (or no fronts/), 1 with one line per problem,
2 when it cannot check: no such root, fronts/ is not a folder, or a folder cannot be read."""
import os
import sys
from shlex import quote as q

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(HERE))
FRONTS = os.path.realpath(os.path.join(ROOT, 'fronts'))


def inside(path, folder):
    rel = os.path.relpath(path, folder)
    return None if rel == os.pardir or rel.startswith(os.pardir + os.sep) else rel


def shown(path):
    """A path as the fix commands name it: fronts/... from the portfolio root, else in full."""
    rel = inside(path, FRONTS)
    if rel is not None:
        return 'fronts' if rel == os.curdir else f'fronts/{rel}'
    return inside(path, ROOT) or path


def from_repo(repo, path):
    """A path given from the root, as git must be handed it after git -C repo: git resolves it
    from repo, not from where the command was typed. Relative to repo, or in full when repo is
    outside the portfolio."""
    if os.path.isabs(repo):
        return os.path.join(ROOT, path)
    return os.path.relpath(os.path.join(ROOT, path), os.path.join(ROOT, repo))


def move_cmd(repo, src, dest):
    """The git worktree move of src to dest (both given from the root), run in repo."""
    return f'git -C {q(repo)} worktree move {q(from_repo(repo, src))} {q(from_repo(repo, dest))}'


def is_bare(folder):
    return all((os.path.isfile(os.path.join(folder, 'HEAD')),
                os.path.isdir(os.path.join(folder, 'objects')),
                os.path.isdir(os.path.join(folder, 'refs'))))


def gitdir_named(dotgit):
    """The git directory a .git file names (relative to the file's folder, as git reads it), or None."""
    try:
        with open(dotgit, encoding='utf-8') as fh:
            line = fh.readline().strip()
    except UnicodeDecodeError:
        return None
    if not line.startswith('gitdir:'):
        return None
    return os.path.realpath(os.path.join(os.path.dirname(dotgit), line[len('gitdir:'):].strip()))


def main_tree(gitdir):
    """The repository a linked worktree's git directory, <common>/worktrees/<id>, belongs to."""
    common = os.path.dirname(os.path.dirname(gitdir))
    try:
        with open(os.path.join(gitdir, 'commondir'), encoding='utf-8') as fh:
            common = os.path.realpath(os.path.join(gitdir, fh.read().strip()))
    except (FileNotFoundError, NotADirectoryError):
        pass
    return os.path.dirname(common) if os.path.basename(common) == '.git' else common


def classify(name):
    """One fronts/ entry: ('repo', its git dir), ('worktree', its git dir) or ('folder', None)."""
    folder = os.path.join(FRONTS, name)
    dotgit = os.path.join(folder, '.git')
    if os.path.isdir(dotgit):
        return 'repo', dotgit
    if os.path.isfile(dotgit):
        gitdir = gitdir_named(dotgit)
        if gitdir and os.path.basename(os.path.dirname(gitdir)) == 'worktrees':
            return 'worktree', gitdir
        return 'repo', gitdir
    if is_bare(folder):
        return 'repo', folder
    return 'folder', None


def housing(name, bare):
    """(front, the repository's new home, the commands that move it there) for a fronts/ entry."""
    here = f'fronts/{name}'
    if bare and name.endswith('.git') and len(name) > 4:
        front = name[:-4]
        home = f'fronts/{front}/{name}'
        return front, home, f'mkdir -p {q("fronts/" + front)} && mv {q(here)} {q(home)}'
    home, n = f'fronts/{name}/{name}', 1
    temp = f'{here}.move'
    while os.path.lexists(os.path.join(ROOT, temp)):
        n += 1
        temp = f'{here}.move-{n}'
    return name, home, f'mv {q(here)} {q(temp)} && mkdir {q(here)} && mv {q(temp)} {q(home)}'


def linked_worktrees(gitdir, folder):
    """How many linked worktrees a repository has, and the path inside folder of each one that
    sits there and so moves with it. Each admin dir's gitdir file names the worktree's .git file;
    git worktree repair, run in the moved repository, needs those paths to reconnect them."""
    links = os.path.join(gitdir, 'worktrees') if gitdir else None
    if not links or not os.path.isdir(links):
        return 0, []
    ids, moved = sorted(os.listdir(links)), []
    for wid in ids:
        try:
            with open(os.path.join(links, wid, 'gitdir'), encoding='utf-8') as fh:
                where = os.path.dirname(os.path.realpath(os.path.join(links, wid, fh.read().strip())))
        except (FileNotFoundError, NotADirectoryError, UnicodeDecodeError):
            continue
        rel = inside(where, folder)
        if rel and rel != os.curdir:
            moved.append(rel)
    return len(ids), moved


def repo_problem(name, gitdir, bare):
    front, home, move = housing(name, bare)
    line = (f"fronts/{name} is itself a git repository; a front's folder holds its repositories. "
            f"Fix: {move}, then set its spoke's path: to {home}.")
    count, moved = linked_worktrees(gitdir, os.path.join(FRONTS, name))
    if count:
        repair = ' '.join([f'git -C {q(home)} worktree repair'] + [q(p) for p in moved])
        line += f' It has {count} linked worktree(s): after the move, run {repair}.'
    return line


def stale_problem(name, gitdir):
    here, wid = f'fronts/{name}', os.path.basename(gitdir)
    old = main_tree(gitdir)
    head = f'{here} is a worktree whose repository has moved or is missing (its .git file names {shown(gitdir)}).'
    rel = inside(old, FRONTS)
    if rel and rel != os.curdir and os.sep not in rel:
        for bare in (False, True):
            front, home, _ = housing(rel, bare)
            admin = os.path.join(ROOT, home, 'worktrees' if bare else '.git/worktrees', wid)
            if os.path.isdir(admin):
                dest = f'fronts/{front}/{name}'
                return (f'{here} is a worktree whose repository has moved to {home}. Fix: git -C {q(home)} '
                        f'worktree repair, then {move_cmd(home, here, dest)}.')
    return (f'{head} Fix: run git worktree repair in that repository where it now lives, '
            'then run this check again for the move.')


def worktree_problem(name, gitdir, kinds):
    if not os.path.isdir(gitdir):
        return stale_problem(name, gitdir)
    here, main = f'fronts/{name}', main_tree(gitdir)
    head = f"{here} is a worktree of {shown(main)}, at the top of fronts/ instead of inside its front's folder."
    rel = inside(main, FRONTS)
    if rel is None or rel == os.curdir:
        return f'{head} Fix: {move_cmd(shown(main), here, "fronts/FRONT/" + name)}, where FRONT is the front it serves.'
    entry = rel.split(os.sep)[0]
    if rel == entry:
        kind, top_gitdir = kinds.get(entry, ('folder', None))
        if kind != 'repo':
            return stale_problem(name, gitdir)
        front, home, _ = housing(entry, top_gitdir == os.path.join(FRONTS, entry))
        return (f'{head} Fix: after {shown(main)} moves into {home} and git -C {q(home)} worktree repair '
                f'has run, {move_cmd(home, here, "fronts/" + front + "/" + name)}.')
    return f'{head} Fix: {move_cmd(shown(main), here, "fronts/" + entry + "/" + name)}.'


def check():
    if not os.path.isdir(ROOT):
        return 2, [f'check-fronts: no such folder {ROOT}']
    if not os.path.lexists(os.path.join(ROOT, 'fronts')):
        return 0, [f'CHECK-FRONTS CLEAN: no fronts/ folder under {ROOT}, nothing to check.']
    if not os.path.isdir(FRONTS):
        return 2, [f'check-fronts: {os.path.join(ROOT, "fronts")} is not a folder']
    names = sorted(n for n in os.listdir(FRONTS) if os.path.isdir(os.path.join(FRONTS, n)))
    kinds = {n: classify(n) for n in names}
    problems = []
    for n in names:
        kind, gitdir = kinds[n]
        if kind == 'repo':
            problems.append(repo_problem(n, gitdir, gitdir == os.path.join(FRONTS, n)))
        elif kind == 'worktree':
            problems.append(worktree_problem(n, gitdir, kinds))
    if problems:
        return 1, problems + [f'CHECK-FRONTS FAILED: {len(problems)} problem(s) in {len(names)} front folder(s) '
                              f'under fronts/. Run each fix from {ROOT}.']
    return 0, [f'CHECK-FRONTS CLEAN: {len(names)} front folder(s) checked, each holds its repositories.']


def main():
    try:
        code, lines = check()
    except OSError as e:
        code, lines = 2, [f'check-fronts: cannot read {e.filename}: {e.strerror}']
    for line in lines:
        print(line, file=sys.stderr if code == 2 else sys.stdout)
    sys.exit(code)


if __name__ == '__main__':
    main()
