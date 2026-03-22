import type { RulesEdition } from './RulesEdition';

const editions = new Map<string, RulesEdition>();

export function registerEdition(edition: RulesEdition): void {
  editions.set(edition.id, edition);
}

export function getEdition(id: string): RulesEdition | undefined {
  return editions.get(id);
}

export function listEditions(): RulesEdition[] {
  return Array.from(editions.values());
}

export const DEFAULT_EDITION_ID = 'wh40k-10th';
