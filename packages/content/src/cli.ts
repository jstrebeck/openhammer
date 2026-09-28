#!/usr/bin/env node
/**
 * validate-content: walk the content/ tree, validate every file against
 * its schema, and exit non-zero on any failure. Wired into CI so a typo
 * in a pack is a build error.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_CONTENT_ROOT, loadEditionContent } from './loader.js';
import type { ContentKind } from './validate.js';

const contentRoot = process.argv[2] ?? DEFAULT_CONTENT_ROOT;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!existsSync(contentRoot)) fail(`content root not found: ${contentRoot}`);

const editionsDir = join(contentRoot, 'editions');
if (!existsSync(editionsDir)) fail(`no editions directory under ${contentRoot}`);

let fileCount = 0;
let editionCount = 0;

for (const editionId of readdirSync(editionsDir)) {
  const dir = join(editionsDir, editionId);
  if (!statSync(dir).isDirectory()) continue;
  editionCount++;
  try {
    const loaded = loadEditionContent(editionId, contentRoot);
    const counts = [
      `${loaded.weaponAbilities.length} weapon abilities`,
      `${loaded.coreAbilities.length} core abilities`,
      `${loaded.coreStratagems.length} stratagems`,
      `${loaded.deploymentMaps.length} deployment maps`,
      `${loaded.missions.length} missions`,
    ];
    fileCount += 4 + (loaded.deploymentMaps.length > 0 ? 2 : 0);
    console.log(`✓ edition ${editionId} (${loaded.edition.version}): ${counts.join(', ')}`);
  } catch (e) {
    fail(`edition ${editionId}: ${(e as Error).message}`);
  }
}

// Faction packs (validated individually once they exist).
const factionsDir = join(contentRoot, 'factions');
if (existsSync(factionsDir)) {
  const { validateContent, formatIssues } = await import('./validate.js');
  const { readFileSync } = await import('node:fs');
  const walk = (dir: string, kind: ContentKind, pattern: RegExp) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) continue;
      if (!pattern.test(entry)) continue;
      fileCount++;
      const data = JSON.parse(readFileSync(p, 'utf8'));
      const result = validateContent(kind, data);
      if (!result.valid) fail(formatIssues(relative(contentRoot, p), result.issues));
      console.log(`✓ ${kind}: ${relative(contentRoot, p)}`);
    }
  };
  for (const editionId of readdirSync(factionsDir)) {
    const editionFactions = join(factionsDir, editionId);
    if (!statSync(editionFactions).isDirectory()) continue;
    for (const factionId of readdirSync(editionFactions)) {
      const fdir = join(editionFactions, factionId);
      if (!statSync(fdir).isDirectory()) continue;
      walk(fdir, 'faction', /^faction\.json$/);
      walk(join(fdir, 'datasheets'), 'datasheet', /\.json$/);
      walk(join(fdir, 'detachments'), 'detachment', /\.json$/);
    }
  }
}

console.log(`\ncontent OK — ${editionCount} edition(s) validated`);
