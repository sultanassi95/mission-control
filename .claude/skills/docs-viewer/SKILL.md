---
name: docs-viewer
description: Generates docs-viewer.html and docs-viewer-server.cjs at the project root - a live local documentation browser. File list and content update in real-time while the server is running. Mermaid code blocks are pre-rendered to SVG on startup and displayed as diagrams (cached in .docs-viewer-cache/ for external use). Adds a "docs-viewer" npm script plus marked + dompurify + @mermaid-js/mermaid-cli devDependencies to package.json. Use when the user runs /docs-viewer in any project.
---

# /docs-viewer

Generates two files at the project root:
- `docs-viewer-server.cjs` - a Node.js server using only built-ins (http, fs, path, net, os, child_process); on startup it pre-renders all Mermaid code blocks to SVG files in `.docs-viewer-cache/` (via `mmdc`), transforms `.md` responses to replace rendered blocks with `<img>` references, and serves the viewer
- `docs-viewer.html` - the browser UI; polls `/api/files` every 6 s for the live file list, polls the open file every 6 s for content changes (silent re-render, scroll preserved), opens the project-root README by default, and has a collapsible + drag-resizable sidebar

Run once: `npm run docs-viewer` (or `pnpm`). The viewer stays live for the entire session - no re-running needed when docs change.

---

## Hard constraints (do not deviate)

These are baked into the templates below - they exist because of failures encountered in real projects. Re-introducing the broken form will reproduce the failures.

1. **Server file extension MUST be `.cjs`.** Many modern projects have `"type": "module"` in `package.json`. A `.js` file in such a project is loaded as ESM and `require('http')` throws `ReferenceError: require is not defined in ES module scope`. The `.cjs` extension forces CommonJS regardless of the project's module type, so the template works everywhere with no detection or branching. Do NOT name it `docs-viewer-server.js`.

2. **HTML must never assign untrusted content to the `innerHTML` property.** Some environments run a pre-write XSS hook that blocks any file with a direct assignment statement targeting that property and recommends DOMPurify. The HTML template below uses three layers: (a) `marked.parse()` → (b) `DOMPurify.sanitize()` → (c) `DOMParser` + `importNode` + `DocumentFragment` to graft nodes into the live DOM. The risky assignment pattern appears nowhere in the generated script. Preserve this pattern when regenerating or editing the HTML; do not "simplify" it back to string-to-DOM assignment.

3. **The file walk MUST prune excluded directories, never read the whole tree then filter.** `fs.readdirSync(ROOT, { recursive: true })` walks *everything* - including `node_modules` (100k+ entries in a real workspace) - synchronously, on every `/api/files` poll. Measured at 21 seconds per call, it freezes the event loop and stalls every request (the browser's 6-connection limit fills with pending fetches). The template uses an explicit iterative walk that skips `node_modules`, `.git`, `.claude`, `.docs-viewer-cache` at *every* level and never follows symlinks. Do NOT replace it with `{ recursive: true }`.

4. **Client libraries are served locally from `node_modules`, never from a CDN.** This is a localhost tool; a remote CDN makes it slow on cold/throttled networks and fully broken offline. `marked` and `dompurify` are added as **devDependencies** and served by the server at `/vendor/*`. Do NOT revert the HTML to `<script src="https://cdn.jsdelivr.net/...">`.

5. **`.docs-viewer-cache/` MUST be in `SKIP_DIRS`.** The server writes pre-rendered Mermaid SVGs into this directory at startup. Explicit exclusion from the file walk prevents it from ever appearing in the sidebar (no `.md` files live there, but the rule is load-bearing if the structure ever changes). The directory is safe to delete at any time - the next `npm run docs-viewer` regenerates every missing image.

---

## Behaviour

**Fresh mode** - none of `docs-viewer.html`, `docs-viewer-server.cjs`, `docs-viewer-server.js` exist: generate both files → add the `marked` + `dompurify` devDependencies and the npm script → run the install.

**Update mode** - files already exist (typical case after initial generation): since the server discovers files dynamically, no update is needed. Tell the user:
`"docs-viewer.html is already live-reload capable. Just run npm run docs-viewer."`
Only re-generate if the user explicitly requests it (or to pick up the perf/vendoring/UX fixes in this version).

**Legacy migration** - `docs-viewer-server.js` exists (from an older generation of this skill) AND `package.json` has `"type": "module"`: the project will fail with the ESM `require` error. Rename `.js` → `.cjs` and update the `package.json` script accordingly. No need to regenerate the HTML.

---

## Step 1 - Collect eligible files (for Fresh mode only)

Walk `**/*.md` from the project root, pruning the directories `node_modules`, `.git`, `.claude` at every level (never descend into them) and skipping the file names `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`.

Sort: root-level files first (alphabetical), then subdirectory paths (alphabetical by full path).

The eligible-file logic is also implemented server-side and runs at request time - the walk in this step is purely for the user-facing summary, not for baking the list into the HTML.

---

## Step 2 - Determine project name

Use the directory name of the project root. If `package.json` has a `name` field, prefer that.

---

## Step 3 - Generate docs-viewer-server.cjs (Fresh mode)

Write `docs-viewer-server.cjs` using the template below. This file:
- Requires Node 18.17+ (exits with a clear error on older versions)
- Auto-detects a free port starting at 4321, skipping reserved dev-server ports (3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8443)
- Accepts `--port=N`, `-p N`, or `DOCS_VIEWER_PORT` env var to override
- Serves `GET /api/files` → JSON array of eligible `.md` paths via a pruned iterative walk (forward-slash normalized, root files first)
- Serves `GET /vendor/marked.umd.js` and `GET /vendor/purify.min.js` from the project's installed `marked` / `dompurify` packages (resolved via `require.resolve`, pnpm-symlink aware); returns a clear 503 if not installed
- Serves all other paths as static files from the project root (with path traversal guard)
- Opens the browser on start via `execFile` (no shell injection risk)
- `GET /` → serves `docs-viewer.html`
- Warns on startup if the client libs are missing

```js
#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const net  = require('net');
const os   = require('os');
const { execFile } = require('child_process');

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 18 || (nodeMajor === 18 && nodeMinor < 17)) {
  process.stderr.write(
    `[docs-viewer] Node.js 18.17+ is required.\n` +
    `  Current version: ${process.versions.node}\n` +
    `  Upgrade: https://nodejs.org\n`
  );
  process.exit(1);
}

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, '.docs-viewer-cache');

const EXCLUDED_NAMES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);
// Directories pruned at every level - never descended into. Pruning DURING the
// walk (vs. reading everything then filtering) is critical: a recursive read of
// node_modules walks 100k+ entries synchronously and freezes the server on
// every poll.
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.docs-viewer-cache']);

const RESERVED_PORTS = new Set([
  3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8443,
]);

function getPreferredPort() {
  const args = process.argv.slice(2);
  const eqArg = args.find(a => /^(--port|-p)=/.test(a));
  if (eqArg) return parseInt(eqArg.split('=')[1], 10) || 4321;
  const flagIdx = args.findIndex(a => a === '--port' || a === '-p');
  if (flagIdx !== -1 && args[flagIdx + 1]) return parseInt(args[flagIdx + 1], 10) || 4321;
  if (process.env.DOCS_VIEWER_PORT) return parseInt(process.env.DOCS_VIEWER_PORT, 10) || 4321;
  return 4321;
}

function findFreePort(candidate, callback) {
  const probe = net.createServer();
  probe.listen(candidate, '127.0.0.1', () => {
    probe.close(() => callback(candidate));
  });
  probe.on('error', () => {
    let next = candidate + 1;
    while (RESERVED_PORTS.has(next)) next++;
    findFreePort(next, callback);
  });
}

function getEligibleFiles() {
  const out = [];
  const stack = [ROOT];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const ent of entries) {
      // Only descend into real directories (symlinks report isDirectory()===false,
      // so pnpm's symlinked node_modules are never followed) and skip SKIP_DIRS.
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(path.join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.md') && !EXCLUDED_NAMES.has(ent.name)) {
        out.push(path.relative(ROOT, path.join(dir, ent.name)).split(path.sep).join('/'));
      }
    }
  }
  return out.sort((a, b) => {
    const aRoot = !a.includes('/');
    const bRoot = !b.includes('/');
    if (aRoot && !bRoot) return -1;
    if (!aRoot && bRoot) return  1;
    return a.localeCompare(b);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml', '.ico': 'image/x-icon',
};

// Vendored client libraries - served from the project's own node_modules so the
// viewer never round-trips to a remote CDN (instant load + works fully offline).
// Install via devDependencies: `marked` + `dompurify` (see package.json).
const VENDOR = {
  '/vendor/marked.umd.js': { pkg: 'marked',    sub: 'lib/marked.umd.js' },
  '/vendor/purify.min.js': { pkg: 'dompurify', sub: 'dist/purify.min.js' },
};
const vendorCache = new Map();

// Resolve a package's installed file by resolving its (always-exported) main
// entry, then walking up to the package root and joining the known subpath.
// Avoids `require.resolve(pkg + '/package.json')`, which modern `exports`
// fields block, and follows pnpm's `.pnpm/` symlinks to the real version.
function resolveVendor(pkg, sub) {
  try {
    let dir = path.dirname(require.resolve(pkg));
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const candidate = path.join(dir, sub);
        if (fs.existsSync(candidate)) return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* package not installed */ }
  return null;
}

function serveVendor(res, urlPath) {
  const spec = VENDOR[urlPath];
  if (!vendorCache.has(urlPath)) vendorCache.set(urlPath, resolveVendor(spec.pkg, spec.sub));
  const abs = vendorCache.get(urlPath);
  if (!abs) {
    res.writeHead(503, { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(`/* docs-viewer: "${spec.pkg}" is not installed. Run: pnpm install */\n`);
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    // Versioned by the lockfile install - safe to cache for the session.
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

// ── Mermaid pre-rendering ─────────────────────────────────────────────────────
// On startup, scans all .md files for ```mermaid``` blocks and renders each one
// to an SVG in .docs-viewer-cache/ (directory structure mirrors the source path,
// e.g. _command/CONSTITUTION.md → .docs-viewer-cache/_command/CONSTITUTION.md-mermaid-0.svg).
// Blocks that already have a cached SVG are skipped - delete .docs-viewer-cache/
// to force a full re-render. The client polls every 6 s, so diagrams appear
// automatically as they finish generating in the background.

function extractMermaidBlocks(mdContent) {
  const blocks = [];
  const lines = mdContent.split('\n');
  let inBlock = false, blockLines = [], blockIndex = 0;
  for (const line of lines) {
    if (!inBlock && /^```mermaid\s*$/.test(line)) { inBlock = true; blockLines = []; }
    else if (inBlock && /^```\s*$/.test(line)) {
      blocks.push({ index: blockIndex++, content: blockLines.join('\n') });
      inBlock = false; blockLines = [];
    } else if (inBlock) { blockLines.push(line); }
  }
  return blocks;
}

function getCacheFilePath(relMdPath, blockIndex) {
  const normalized = relMdPath.replace(/\\/g, '/');
  const svgName = path.basename(normalized) + '-mermaid-' + blockIndex + '.svg';
  const sub = path.dirname(normalized);
  return sub === '.' ? path.join(CACHE_DIR, svgName) : path.join(CACHE_DIR, sub, svgName);
}

// Transforms .md content at serve time: replaces ```mermaid``` blocks with
// ![Mermaid diagram N](url) references where a cached SVG exists. Blocks not
// yet rendered are passed through unchanged (they render as code blocks until
// the next poll cycle after generation finishes).
function transformMdContent(relPath, content) {
  const lines = content.split('\n');
  const output = [];
  let inBlock = false, blockLines = [], blockIndex = 0;
  for (const line of lines) {
    if (!inBlock && /^```mermaid\s*$/.test(line)) { inBlock = true; blockLines = []; }
    else if (inBlock && /^```\s*$/.test(line)) {
      const cachePath = getCacheFilePath(relPath, blockIndex);
      if (fs.existsSync(cachePath)) {
        const urlPath = '/' + path.relative(ROOT, cachePath).split(path.sep).join('/');
        output.push(`![Mermaid diagram ${blockIndex}](${urlPath})`);
      } else {
        output.push('```mermaid', ...blockLines, '```');
      }
      blockIndex++; inBlock = false; blockLines = [];
    } else if (inBlock) { blockLines.push(line); }
    else { output.push(line); }
  }
  if (inBlock) { output.push('```mermaid', ...blockLines); } // unterminated block
  return output.join('\n');
}

function findMmdc() {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  const local = path.join(ROOT, 'node_modules', '.bin', 'mmdc' + ext);
  return fs.existsSync(local) ? local : null;
}

function renderMermaidSvg(mmdcPath, content, outputPath, callback) {
  const tmpFile = path.join(os.tmpdir(), 'dv-mmdc-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mmd');
  fs.writeFile(tmpFile, content, 'utf-8', (err) => {
    if (err) { callback(err); return; }
    const args = ['-i', tmpFile, '-o', outputPath, '-e', 'svg', '--quiet'];
    const cleanup = (e) => { fs.unlink(tmpFile, () => {}); callback(e); };
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', mmdcPath, ...args], { timeout: 30000 }, cleanup);
    } else {
      execFile(mmdcPath, args, { timeout: 30000 }, cleanup);
    }
  });
}

function generateMermaidImages() {
  const mmdcPath = findMmdc();
  if (!mmdcPath) {
    process.stderr.write('[docs-viewer] Mermaid: @mermaid-js/mermaid-cli not found - run `pnpm install` to enable diagram rendering.\n');
    return;
  }
  const tasks = [];
  for (const relPath of getEligibleFiles()) {
    let content;
    try { content = fs.readFileSync(path.join(ROOT, relPath), 'utf-8'); } catch { continue; }
    for (const block of extractMermaidBlocks(content)) {
      const cachePath = getCacheFilePath(relPath, block.index);
      if (!fs.existsSync(cachePath)) tasks.push({ relPath, block, cachePath });
    }
  }
  if (tasks.length === 0) { process.stdout.write('[docs-viewer] Mermaid: all diagrams up to date.\n'); return; }
  process.stdout.write(`[docs-viewer] Mermaid: generating ${tasks.length} new diagram(s)...\n`);
  // Sequential: mmdc spawns Chromium per call; parallel would thrash memory.
  (function next(i) {
    if (i >= tasks.length) { process.stdout.write('[docs-viewer] Mermaid: done.\n'); return; }
    const { relPath, block, cachePath } = tasks[i];
    try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); } catch {}
    renderMermaidSvg(mmdcPath, block.content, cachePath, (err) => {
      if (err) process.stderr.write(`[docs-viewer] Mermaid: ✗ ${relPath}[${block.index}]: ${err.message}\n`);
      else     process.stdout.write(`[docs-viewer] Mermaid: ✓ ${relPath} [${block.index}]\n`);
      next(i + 1);
    });
  })(0);
}

function serveFile(res, relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(abs).toLowerCase();
    let body = data;
    if (ext === '.md') {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      body = Buffer.from(transformMdContent(rel, data.toString('utf-8')), 'utf-8');
    }
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache, no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/files') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(getEligibleFiles()));
    return;
  }
  if (VENDOR[url]) { serveVendor(res, url); return; }
  if (url === '/' || url === '') { serveFile(res, 'docs-viewer.html'); return; }
  serveFile(res, url.startsWith('/') ? url.slice(1) : url);
});

function openBrowser(url) {
  try {
    if      (process.platform === 'win32')  execFile('cmd',      ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (process.platform === 'darwin') execFile('open',     [url],                    { stdio: 'ignore' });
    else                                    execFile('xdg-open', [url],                    { stdio: 'ignore' });
  } catch {}
}

const preferred = getPreferredPort();
findFreePort(preferred, (port) => {
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    const missing = Object.values(VENDOR).filter(s => !resolveVendor(s.pkg, s.sub)).map(s => s.pkg);
    if (missing.length) process.stderr.write(`[docs-viewer] Missing client libs: ${missing.join(', ')}. Run \`pnpm install\` - the viewer will fall back to raw text until then.\n`);
    if (port !== preferred) process.stdout.write(`[docs-viewer] Port ${preferred} was in use - using port ${port} instead.\n`);
    process.stdout.write(`[docs-viewer] Serving docs at ${url}\n`);
    process.stdout.write(`[docs-viewer] Press Ctrl+C to stop.\n`);
    openBrowser(url);
    setImmediate(generateMermaidImages);
  });
});
server.on('error', (err) => { process.stderr.write(`[docs-viewer] Server error: ${err.message}\n`); process.exit(1); });
```

---

## Step 4 - Generate docs-viewer.html (Fresh mode)

Write the template below verbatim, replacing only these two placeholders:
- `{{PROJECT_NAME}}` - project name from Step 2
- `{{GENERATED_DATE}}` - today's date as `Month DD, YYYY`

The file count in the topbar is set dynamically by JavaScript on first fetch - no placeholder needed.

**Why this template is non-negotiable**: it loads `marked` + `DOMPurify` from local `/vendor/*` paths (served by the .cjs from `node_modules` - no CDN), and uses `marked` for parsing, `DOMPurify` for sanitization, and `DOMParser` + `importNode` + `DocumentFragment` to insert the parsed nodes - bypassing any XSS pre-write hook that blocks direct HTML-string assignment. Do not rewrite the script to assign HTML strings into live elements even if it looks shorter; the file will be rejected by the hook. Do not point the `<script>` tags back at a CDN.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{{PROJECT_NAME}} - Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Vendored from the project's node_modules (devDeps: marked + dompurify) - served locally, no CDN, works offline. -->
  <script src="/vendor/marked.umd.js"></script>
  <script src="/vendor/purify.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --bg-elevated: #161b22;
      --bg-hover: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --active: #1f6feb;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; }
    body { display: flex; flex-direction: column; }
    .topbar {
      height: 48px; padding: 0 20px; display: flex; align-items: center; gap: 16px;
      background: var(--bg-elevated); border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .topbar .project { font-weight: 600; font-size: 14px; }
    .topbar .meta { color: var(--text-muted); font-size: 12px; font-family: SFMono-Regular, Consolas, monospace; }
    .topbar .dot { width: 8px; height: 8px; border-radius: 50%; background: #2ea043; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .main { flex: 1; display: flex; min-height: 0; }
    /* Sidebar itself doesn't scroll - the tree-root does - so the floating
       actions stay pinned to the top-right corner regardless of scroll. */
    .sidebar { width: 320px; flex-shrink: 0; background: var(--bg-elevated); position: relative; overflow: hidden; }
    .tree-root { height: 100%; overflow-y: auto; padding: 12px 8px; }
    .preview-wrap { flex: 1; overflow-y: auto; }
    /* Drag handle on the sidebar's right border */
    .resizer {
      width: 6px; flex-shrink: 0; cursor: col-resize; background: var(--border);
      transition: background 0.15s; position: relative;
    }
    .resizer:hover, .resizer.dragging { background: var(--accent); }
    /* Collapsed + active-drag states */
    body.sidebar-hidden .sidebar, body.sidebar-hidden .resizer { display: none; }
    body.resizing { cursor: col-resize; user-select: none; }
    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0; border-radius: 6px; cursor: pointer;
      background: transparent; border: 1px solid var(--border); color: var(--text-muted);
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
    .preview { max-width: 900px; margin: 0 auto; padding: 32px 40px; }
    /* Floating actions - absolute to the top-right so they never push the list
       down. Pinned because .sidebar (their offset parent) does not scroll. */
    .tree-actions {
      position: absolute; top: 8px; right: 12px; z-index: 2;
      display: flex; gap: 4px;
    }
    .tree-action-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; padding: 0; border-radius: 4px; cursor: pointer;
      background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-muted);
    }
    .tree-action-btn:hover { background: var(--bg-hover); color: var(--text); }
    .tree-action-btn svg { display: block; }
    .tree { font-size: 14px; }
    .tree-folder { margin: 2px 0; }
    .tree-folder-label {
      display: flex; align-items: center; gap: 4px; cursor: pointer;
      padding: 4px 8px; border-radius: 4px; color: var(--text-muted);
      user-select: none; font-weight: 500;
    }
    .tree-folder-label:hover { background: var(--bg-hover); color: var(--text); }
    .tree-folder-label .caret { display: inline-block; width: 12px; text-align: center; transition: transform 0.15s; font-size: 10px; }
    .tree-folder.collapsed .tree-folder-label .caret { transform: rotate(-90deg); }
    .tree-folder.collapsed > .tree-folder-children { display: none; }
    .tree-folder-children { margin-left: 10px; border-left: 1px solid var(--border); padding-left: 4px; }
    .tree-file {
      display: block; padding: 4px 8px 4px 22px; color: var(--text);
      text-decoration: none; border-radius: 4px; cursor: pointer;
      word-break: break-word; font-size: 14px;
    }
    .tree-file:hover { background: var(--bg-hover); }
    .tree-file.active { background: var(--active); color: white; }
    .breadcrumb {
      color: var(--text-muted); font-size: 12px; margin-bottom: 16px;
      padding-bottom: 12px; border-bottom: 1px solid var(--border);
      font-family: SFMono-Regular, Consolas, monospace;
    }
    .md-content { line-height: 1.7; font-size: 16px; }
    .md-content h1, .md-content h2, .md-content h3, .md-content h4, .md-content h5, .md-content h6 {
      margin-top: 28px; margin-bottom: 12px; font-weight: 600; line-height: 1.25;
    }
    .md-content h1 { font-size: 2em; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    .md-content h2 { font-size: 1.5em; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
    .md-content h3 { font-size: 1.25em; }
    .md-content h4 { font-size: 1em; }
    .md-content p { margin: 12px 0; }
    .md-content a { color: var(--accent); text-decoration: none; }
    .md-content a:hover { text-decoration: underline; }
    .md-content code {
      background: var(--bg-elevated); padding: 2px 6px; border-radius: 4px;
      font-family: SFMono-Regular, Consolas, monospace; font-size: 0.88em;
      border: 1px solid var(--border);
    }
    .md-content pre {
      background: var(--bg-elevated); padding: 16px; border-radius: 6px;
      overflow-x: auto; border: 1px solid var(--border); font-size: 0.9em;
    }
    .md-content pre code { background: none; padding: 0; border: none; }
    .md-content blockquote {
      border-left: 4px solid var(--border); margin: 12px 0;
      padding: 4px 16px; color: var(--text-muted);
    }
    .md-content ul, .md-content ol { padding-left: 28px; margin: 12px 0; }
    .md-content li { margin: 4px 0; }
    .md-content table { border-collapse: collapse; margin: 16px 0; }
    .md-content th, .md-content td { border: 1px solid var(--border); padding: 8px 12px; }
    .md-content th { background: var(--bg-elevated); }
    .md-content img { max-width: 100%; }
    .md-content img[alt^="Mermaid diagram"] {
      display: block; margin: 20px auto; padding: 16px;
      background: #fff; border-radius: 8px; border: 1px solid var(--border);
    }
    .md-content hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
    .empty { color: var(--text-muted); text-align: center; padding: 80px 20px; }
    .loading { color: var(--text-muted); padding: 20px; }
    .tree-root::-webkit-scrollbar, .preview-wrap::-webkit-scrollbar { width: 10px; }
    .tree-root::-webkit-scrollbar-thumb, .preview-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
    .tree-root::-webkit-scrollbar-thumb:hover, .preview-wrap::-webkit-scrollbar-thumb:hover { background: var(--bg-hover); }
  </style>
</head>
<body>
  <div class="topbar">
    <button class="icon-btn" id="sidebar-toggle" type="button" title="Toggle sidebar (Ctrl/Cmd+B)" aria-label="Toggle sidebar">☰</button>
    <div class="dot" title="Live - file list polls every 6s"></div>
    <div class="project">{{PROJECT_NAME}}</div>
    <div class="meta" id="file-count"> -  files</div>
    <div style="flex: 1"></div>
    <div class="meta">Generated {{GENERATED_DATE}}</div>
  </div>
  <div class="main">
    <div class="sidebar" id="sidebar">
      <div class="tree-actions">
        <button class="tree-action-btn" id="expand-all" type="button" title="Expand all folders" aria-label="Expand all folders">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5 8 9l4.5-4.5"/><path d="M3.5 9.5 8 14l4.5-4.5"/></svg>
        </button>
        <button class="tree-action-btn" id="collapse-all" type="button" title="Collapse all folders" aria-label="Collapse all folders">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7 8 2.5 12.5 7"/><path d="M3.5 12 8 7.5 12.5 12"/></svg>
        </button>
      </div>
      <div class="tree-root" id="tree-root"></div>
    </div>
    <div class="resizer" id="resizer" title="Drag to resize · double-click to reset"></div>
    <div class="preview-wrap">
      <div class="preview" id="preview"></div>
    </div>
  </div>
  <script>
    (function () {
      'use strict';

      let currentFiles = [];
      let currentPath = '';
      let currentContentHash = 0;

      const previewEl = document.getElementById('preview');
      const sidebarEl = document.getElementById('sidebar');
      const treeRootEl = document.getElementById('tree-root');
      const fileCountEl = document.getElementById('file-count');

      function djb2(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return h;
      }

      function clearChildren(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
      }

      function makeDiv(className, text) {
        const d = document.createElement('div');
        if (className) d.className = className;
        if (text != null) d.textContent = text;
        return d;
      }

      function setMessage(className, text) {
        clearChildren(previewEl);
        previewEl.appendChild(makeDiv(className, text));
      }

      // Render sanitized HTML (from marked.parse) without any string-to-DOM injection.
      // DOMPurify sanitizes, DOMParser parses into a detached document, then nodes are
      // imported into a DocumentFragment and appended - no risky property assignment.
      function appendSanitizedHtml(container, dirtyHtml) {
        const clean = (window.DOMPurify ? DOMPurify.sanitize(dirtyHtml, { USE_PROFILES: { html: true } }) : '');
        if (!clean) {
          const pre = document.createElement('pre');
          pre.textContent = dirtyHtml;
          container.appendChild(pre);
          return;
        }
        const doc = new DOMParser().parseFromString('<!doctype html><body>' + clean + '</body>', 'text/html');
        const frag = document.createDocumentFragment();
        Array.from(doc.body.childNodes).forEach(n => frag.appendChild(document.importNode(n, true)));
        container.appendChild(frag);
      }

      function buildTree(files) {
        const root = { folders: {}, files: [] };
        for (const p of files) {
          const parts = p.split('/');
          let node = root;
          for (let i = 0; i < parts.length - 1; i++) {
            const name = parts[i];
            if (!node.folders[name]) node.folders[name] = { folders: {}, files: [] };
            node = node.folders[name];
          }
          node.files.push({ name: parts[parts.length - 1], path: p });
        }
        return root;
      }

      function renderTree(node, parentEl, openSet, prefix) {
        const folderNames = Object.keys(node.folders).sort();
        for (const name of folderNames) {
          const fullPath = prefix ? prefix + '/' + name : name;
          const folder = document.createElement('div');
          folder.className = 'tree-folder';
          folder.dataset.folderPath = fullPath;
          if (!openSet.has(fullPath)) folder.classList.add('collapsed');

          const label = document.createElement('div');
          label.className = 'tree-folder-label';
          const caret = document.createElement('span');
          caret.className = 'caret';
          caret.textContent = '▾';
          label.appendChild(caret);
          label.appendChild(document.createTextNode(' ' + name));
          label.addEventListener('click', () => folder.classList.toggle('collapsed'));
          folder.appendChild(label);

          const children = document.createElement('div');
          children.className = 'tree-folder-children';
          folder.appendChild(children);
          renderTree(node.folders[name], children, openSet, fullPath);
          parentEl.appendChild(folder);
        }
        for (const f of node.files) {
          const link = document.createElement('a');
          link.className = 'tree-file';
          link.textContent = f.name;
          link.dataset.path = f.path;
          link.href = '#' + f.path;
          link.addEventListener('click', (e) => { e.preventDefault(); loadFile(f.path); });
          parentEl.appendChild(link);
        }
      }

      function snapshotOpenFolders() {
        const open = new Set();
        document.querySelectorAll('.tree-folder').forEach(f => {
          if (!f.classList.contains('collapsed') && f.dataset.folderPath) {
            open.add(f.dataset.folderPath);
          }
        });
        return open;
      }

      function setActiveHighlight() {
        document.querySelectorAll('.tree-file').forEach(el => {
          el.classList.toggle('active', el.dataset.path === currentPath);
        });
      }

      function fetchFileList() {
        return fetch('/api/files').then(r => r.json()).then(files => {
          const sameList = files.length === currentFiles.length
            && files.every((f, i) => f === currentFiles[i]);
          if (sameList && treeRootEl.children.length > 0) return files;

          // Default to all-collapsed: only folders the user opened (captured in
          // the snapshot) stay open across live re-renders.
          const openFolders = snapshotOpenFolders();
          currentFiles = files;
          const tree = buildTree(files);
          clearChildren(treeRootEl);
          renderTree(tree, treeRootEl, openFolders, '');
          setActiveHighlight();
          fileCountEl.textContent = files.length + ' file' + (files.length === 1 ? '' : 's');
          return files;
        }).catch(() => currentFiles);
      }

      function pollActiveFile() {
        if (!currentPath) return;
        fetch(currentPath + '?_t=' + Date.now()).then(r => {
          if (!r.ok) return null;
          return r.text();
        }).then(text => {
          if (text == null) return;
          const h = djb2(text);
          if (h === currentContentHash) return;
          currentContentHash = h;
          const wrap = document.querySelector('.preview-wrap');
          const scroll = wrap.scrollTop;
          renderMd(currentPath, text, '', true);
          wrap.scrollTop = scroll;
        }).catch(() => {});
      }

      function loadFile(filePath, anchor) {
        currentPath = filePath;
        setActiveHighlight();
        setMessage('loading', 'Loading ' + filePath + '...');
        history.replaceState(null, '', '#' + filePath + (anchor ? '#' + anchor : ''));
        fetch(filePath + '?_t=' + Date.now()).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(text => {
          currentContentHash = djb2(text);
          renderMd(filePath, text, anchor, false);
        }).catch(() => {
          setMessage('empty', 'Failed to load ' + filePath);
        });
      }

      function renderMd(filePath, text, anchor, preserveScroll) {
        clearChildren(previewEl);
        previewEl.appendChild(makeDiv('breadcrumb', filePath));
        const content = makeDiv('md-content');

        let rawHtml = '';
        if (window.marked) {
          try { rawHtml = marked.parse(text); }
          catch { rawHtml = ''; }
        }
        if (rawHtml) {
          appendSanitizedHtml(content, rawHtml);
        } else {
          const pre = document.createElement('pre');
          pre.textContent = text;
          content.appendChild(pre);
        }
        previewEl.appendChild(content);

        if (!preserveScroll) {
          document.querySelector('.preview-wrap').scrollTop = 0;
        }
        if (anchor) {
          requestAnimationFrame(() => {
            const el = document.getElementById(anchor)
              || document.querySelector('[name="' + anchor + '"]');
            if (el) el.scrollIntoView();
          });
        }
      }

      // ── Sidebar: collapse + drag-resize, persisted in localStorage ─────────
      (function initSidebarControls() {
        const toggleBtn = document.getElementById('sidebar-toggle');
        const resizer = document.getElementById('resizer');
        const MIN_W = 160, DEFAULT_W = 320;
        const maxW = () => Math.min(900, window.innerWidth - 200);

        const savedW = parseInt(localStorage.getItem('docsViewerSidebarWidth'), 10);
        if (savedW >= MIN_W) sidebarEl.style.width = Math.min(savedW, maxW()) + 'px';
        if (localStorage.getItem('docsViewerSidebarCollapsed') === '1') {
          document.body.classList.add('sidebar-hidden');
        }

        function toggleSidebar() {
          const hidden = document.body.classList.toggle('sidebar-hidden');
          localStorage.setItem('docsViewerSidebarCollapsed', hidden ? '1' : '0');
        }
        toggleBtn.addEventListener('click', toggleSidebar);
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            toggleSidebar();
          }
        });

        let dragging = false;
        resizer.addEventListener('mousedown', (e) => {
          dragging = true;
          document.body.classList.add('resizing');
          resizer.classList.add('dragging');
          e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          const left = sidebarEl.getBoundingClientRect().left;
          const w = Math.max(MIN_W, Math.min(e.clientX - left, maxW()));
          sidebarEl.style.width = w + 'px';
        });
        document.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          document.body.classList.remove('resizing');
          resizer.classList.remove('dragging');
          localStorage.setItem('docsViewerSidebarWidth', String(parseInt(sidebarEl.style.width, 10) || DEFAULT_W));
        });
        resizer.addEventListener('dblclick', () => {
          sidebarEl.style.width = DEFAULT_W + 'px';
          localStorage.setItem('docsViewerSidebarWidth', String(DEFAULT_W));
        });
      })();

      // Expand-all / collapse-all - always-visible actions at the top of the list.
      document.getElementById('expand-all').addEventListener('click', () => {
        document.querySelectorAll('.tree-folder').forEach(f => f.classList.remove('collapsed'));
      });
      document.getElementById('collapse-all').addEventListener('click', () => {
        document.querySelectorAll('.tree-folder').forEach(f => f.classList.add('collapsed'));
      });

      // In-content links: relative .md links load inside the viewer instead
      // of navigating the page to the raw file. External links, pure #hash
      // links, and non-md files keep default browser behavior.
      previewEl.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!a || !previewEl.contains(a)) return;
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
        const parts = href.split('#');
        if (!/\.md$/i.test(parts[0])) return;
        let resolved;
        try {
          const baseDir = currentPath ? currentPath.slice(0, currentPath.lastIndexOf('/') + 1) : '';
          resolved = decodeURIComponent(new URL(parts[0], 'http://x/' + baseDir).pathname).replace(/^\//, '');
        } catch { return; }
        if (!currentFiles.includes(resolved)) return;
        e.preventDefault();
        loadFile(resolved, parts[1] || '');
      });

      setMessage('empty', 'Select a file from the sidebar.');

      fetchFileList().then(files => {
        const hash = window.location.hash.slice(1);
        if (hash) {
          const hashParts = hash.split('#');
          const filePath = hashParts[0];
          const anchor = hashParts[1] || '';
          if (files.includes(filePath)) { loadFile(filePath, anchor); return; }
        }
        // Nothing selected → open the project-root README (any case) by default.
        const rootReadme = files.find(f => !f.includes('/') && /^readme\.md$/i.test(f));
        if (rootReadme) loadFile(rootReadme);
      });

      setInterval(fetchFileList, 6000);
      setInterval(pollActiveFile, 6000);
    })();
  </script>
</body>
</html>
```

---

## Step 5 - Update package.json + install client libs

The viewer needs `marked` and `dompurify` installed (served locally at `/vendor/*`). Add them as **devDependencies** and add the npm script, then run the install.

1. **Scripts** - add `"docs-viewer": "node docs-viewer-server.cjs"` to `scripts` (if `package.json` doesn't exist, create it with this script). If a legacy `"docs-viewer"` points at `docs-viewer-server.js`, update it to `.cjs`.
2. **devDependencies** - add `marked`, `dompurify`, and `@mermaid-js/mermaid-cli` (e.g. `"marked": "^18.0.4"`, `"dompurify": "^3.4.5"`, `"@mermaid-js/mermaid-cli": "^11.4.0"`). Leave any already-present compatible version. Note: `@mermaid-js/mermaid-cli` triggers a one-time Playwright + Chromium download (~300 MB) on first install; this is expected.
3. **Install** - run the project's package manager so the libs land in `node_modules`: `pnpm install` (or `npm install` / `yarn`). Detect from the lockfile (`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm, `yarn.lock` → yarn).
4. **`.gitignore`** - append `.docs-viewer-cache/` to the project's `.gitignore` (or create the file if missing). The cache holds generated SVGs that are reproducible from source and must not be committed.

Touch nothing else in `package.json`.

---

## After writing files

Tell the user:
- Fresh: `"Created docs-viewer-server.cjs and docs-viewer.html, added marked + dompurify + @mermaid-js/mermaid-cli devDeps and the docs-viewer script, and installed. Run npm run docs-viewer - opens at http://localhost:4321 (auto-detects free port). The root README opens by default; the file tree and content update live. Mermaid diagrams are rendered to SVG in the background on first run and cached in .docs-viewer-cache/ - delete that directory to force regeneration."`
- Update mode: `"docs-viewer is already live-reload capable. Run npm run docs-viewer to launch it."` (If the existing copy predates Mermaid support or the local-vendoring fix, offer to regenerate: it adds diagram pre-rendering to .docs-viewer-cache/, removes the CDN dependency, fixes the slow file-list scan, and adds the collapsible/resizable sidebar.)
- Legacy migration: `"Renamed docs-viewer-server.js → docs-viewer-server.cjs and updated the npm script (your project has \"type\": \"module\", which made Node refuse to load the .js file as CommonJS). Run npm run docs-viewer."`
