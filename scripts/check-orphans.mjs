#!/usr/bin/env node
/**
 * Orphan-export lint (v1 post-mortem lesson #4: nine fully-built React
 * components were never mounted). Flags exported functions/consts/classes
 * that no file outside their own module references. Barrel re-exports
 * (index.ts `export ... from`) do NOT count as usage — a symbol that is
 * only re-exported is still an orphan. Test files DO count as usage
 * (weaker than "wired into the app", but integration tests exercise the
 * real dispatch path here, and the noise trade-off is worth it).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = [
  'packages/core/src',
  'packages/content/src',
  'packages/content/tools',
  'packages/server/src',
  'packages/client/src',
];

/** Intentional public API / entrypoints with no internal importer. */
const ALLOWLIST = new Set([
  // Entrypoints and bins
  'packages/server/src/main.ts:*',
  'packages/content/src/cli.ts:*',
  'packages/client/src/main.tsx:*',
]);
const ALLOW_SYMBOLS = new Set([
  // Deliberate library surface consumed by future milestones/tools.
  'startServer', // also started via main.ts at runtime
  'ContentLoadError', // public error type for pack consumers to catch
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm;

const orphans = [];
for (const [file, src] of sources) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.has(`${rel}:*`)) continue;
  for (const match of src.matchAll(EXPORT_RE)) {
    const name = match[1];
    if (ALLOW_SYMBOLS.has(name)) continue;
    const word = new RegExp(`\\b${name}\\b`);
    let used = false;
    for (const [other, otherSrc] of sources) {
      if (other === file) continue;
      if (!word.test(otherSrc)) continue;
      // Barrel re-exports don't count as usage.
      const isBarrel = /(^|\/)index\.tsx?$/.test(other);
      if (isBarrel) {
        // Count only if the barrel USES it beyond `export ... from`.
        const lines = otherSrc.split('\n').filter((l) => word.test(l));
        const nonReexport = lines.some(
          (l) => !/^\s*export\s+(type\s+)?\{|^\s*export\s+\*|^\s*[A-Za-z_$][\w$]*,?\s*$|^\s*type\s+[A-Za-z_$][\w$]*,?\s*$|from\s+'/.test(l),
        );
        if (!nonReexport) continue;
      }
      used = true;
      break;
    }
    if (!used) orphans.push(`${rel}: ${name}`);
  }
}

if (orphans.length > 0) {
  console.error(`✗ ${orphans.length} orphaned export(s) — wire them up or delete them:`);
  for (const o of orphans) console.error(`  - ${o}`);
  process.exit(1);
}
console.log(`✓ no orphaned exports across ${files.length} files`);
