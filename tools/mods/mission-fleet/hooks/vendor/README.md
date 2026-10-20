# Vendored: acorn 8.14.0

The fleet guard parses a Controller's Workflow script with acorn (`../workflow.ts`).
A plugin loads no npm packages, so the parser ships here as one ES module.

| File | From | sha256 |
|---|---|---|
| `acorn.mjs` | `acorn@8.14.0/dist/acorn.mjs`, one line patched (below) | `b001cdc5db264cc67f1aa6fb5452a553fba9d1d357b98a1d061d312d09f6cc6d` |
| `acorn.d.mts` | `acorn@8.14.0/dist/acorn.d.mts`, unchanged | `796300d2a75b7b2b1ad8837c7808298928c803879a64b13ce4d4db2822de66fc` |
| `ACORN-LICENSE` | `acorn@8.14.0/LICENSE` (MIT), unchanged | `76a876cf886ff9be2a8b5e2e86514fed06223c8c9f0c1e9ee9606e93841e00b7` |

The unpatched `acorn.mjs` has sha256
`402f6759c744ea2ca501c1dc4ded8b1c54c9066cc7a741837057dcb68bc64c93`. The patch
changes the text `import()` to `import ( )` inside one error message, because
the plugin loader refuses a module whose source contains `import(`. No code
changes.

To upgrade: replace the three files from the new release, re-apply the
one-line patch, update the hashes here, and run the mod's tests.
