# Machine profile - <hostname> (auto-detected; regenerate any time)

> Per machine, gitignored, never travels. Missing or `os:` mismatched
> with the running OS? Regenerate by detection (`framework/platform.md`
> rule 4). Loaded every session via the root CLAUDE.md.

detected: <YYYY-MM-DD>
os: <windows 11 | macos <v> | linux <distro>>
primary_shell: <powershell 5.1 | pwsh 7 | bash | zsh> (others present: <list>)
path_style: <backslash, C:\ drives - quote spaces | forward slash>
line_endings: <crlf | lf>
console_encoding: <e.g. legacy codepage - expect mangled unicode glyphs>

## Tools present (detected)
<git v · node v (+ version manager and pins) · package manager v ·
gh · jq · docker · ...>

## Tools ABSENT that habit might assume
<e.g. rg not on PATH (harness grep is bundled, shell rg is not) ·
sed/awk absent · robocopy absent - each with the local equivalent>

## Platform rules for THIS machine (copied from framework/platform.md)
- <only the applicable crib lines>

## Preferences (confirmed at the Stage 4 gate, corrected any time)
package_manager: <pnpm | npm | yarn> · terminal: <what the founder uses>
