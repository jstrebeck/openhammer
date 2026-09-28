import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

/** The content schema version this build of the loader understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

export type ContentKind =
  | 'edition'
  | 'core-rules'
  | 'weapon-abilities'
  | 'stratagems'
  | 'deployment-maps'
  | 'missions'
  | 'terrain-layouts'
  | 'datasheet'
  | 'detachment'
  | 'faction';

const KIND_TO_SCHEMA_ID: Record<ContentKind, string> = {
  edition: 'openhammer://schemas/edition',
  'core-rules': 'openhammer://schemas/core-rules',
  'weapon-abilities': 'openhammer://schemas/weapon-abilities',
  stratagems: 'openhammer://schemas/stratagems',
  'deployment-maps': 'openhammer://schemas/deployment-maps',
  missions: 'openhammer://schemas/missions',
  'terrain-layouts': 'openhammer://schemas/terrain-layouts',
  datasheet: 'openhammer://schemas/datasheet',
  detachment: 'openhammer://schemas/detachment',
  faction: 'openhammer://schemas/faction',
};

let ajv: Ajv2020 | null = null;

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  for (const file of readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith('.schema.json')) continue;
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8'));
    ajv.addSchema(schema);
  }
  return ajv;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validate a parsed content file against its schema, including the
 * schema-version gate. A typo in a datasheet must be a load error with a
 * pointable path, never a runtime mystery.
 */
export function validateContent(kind: ContentKind, data: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  const header = data as { schemaVersion?: unknown } | null;
  if (!header || typeof header !== 'object') {
    return { valid: false, issues: [{ path: '', message: 'content file must be a JSON object' }] };
  }
  if (header.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    issues.push({
      path: '/schemaVersion',
      message: `pack targets schema version ${String(header.schemaVersion)}, but this loader supports version ${SUPPORTED_SCHEMA_VERSION}`,
    });
    return { valid: false, issues };
  }

  const validator = getAjv().getSchema(KIND_TO_SCHEMA_ID[kind]) as ValidateFunction | undefined;
  if (!validator) {
    return { valid: false, issues: [{ path: '', message: `no schema registered for kind "${kind}"` }] };
  }
  const valid = validator(data) as boolean;
  if (!valid) {
    for (const err of validator.errors ?? []) {
      issues.push({
        path: err.instancePath || '/',
        message: `${err.message ?? 'invalid'}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

export function formatIssues(file: string, issues: ValidationIssue[]): string {
  return issues.map((i) => `${file}${i.path ? ` at ${i.path}` : ''}: ${i.message}`).join('\n');
}
