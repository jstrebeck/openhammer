#!/usr/bin/env node
/**
 * CLI shim: generate faction packs from the sample rosters into
 * content/factions/**. Run with:
 *   npx tsx packages/content/tools/generate-packs-from-samples.ts
 * All logic lives in src/generate-packs.ts so tests can call it directly.
 */
import {
  generateFactionPacks,
  validateGeneratedPacks,
  writeGeneratedPacks,
} from '../src/generate-packs.js';
import { formatIssues } from '../src/validate.js';

const packs = generateFactionPacks();

const failures = validateGeneratedPacks(packs);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`✗ ${formatIssues(failure.file, failure.issues)}`);
  }
  process.exit(1);
}

const files = writeGeneratedPacks(packs);
for (const pack of packs) {
  const weaponCount = pack.datasheets.reduce(
    (n, d) => n + d.rangedWeapons.length + d.meleeWeapons.length,
    0,
  );
  console.log(
    `✓ ${pack.faction.id}: ${pack.datasheets.length} datasheets, ${weaponCount} weapon profiles`,
  );
  for (const warning of pack.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }
}
console.log(`\nwrote ${files.length} files`);
