export {
  DEFAULT_CONTENT_ROOT,
  ContentLoadError,
  loadEditionContent,
  loadFactionPack,
  instantiateAbilityEffects,
  type CoreAbilityDef,
  type LoadedEditionContent,
  type LoadedFactionPack,
} from './loader.js';
export {
  parseRoster,
  matchRoster,
  normalizeName,
  type ParsedRoster,
  type RosterUnit,
  type RosterWeapon,
  type RosterProfile,
  type RosterCharacteristic,
  type ImportResult,
  type ImportedUnit,
} from './importer.js';
export {
  SUPPORTED_SCHEMA_VERSION,
  validateContent,
  formatIssues,
  type ContentKind,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
export { WH40K_10E_SCRIPTS } from './scripts/wh40k-10e.js';
