import type { FactionDefinition, Detachment } from '../types/index';

const factionRegistry = new Map<string, FactionDefinition>();
const catalogueNameIndex = new Map<string, string>(); // catalogueName → factionId

export function registerFaction(faction: FactionDefinition): void {
  factionRegistry.set(faction.id, faction);
  for (const name of faction.catalogueNames) {
    catalogueNameIndex.set(name.toLowerCase(), faction.id);
  }
}

export function getFaction(id: string): FactionDefinition | undefined {
  return factionRegistry.get(id);
}

export function getFactionByCatalogueName(name: string): FactionDefinition | undefined {
  const factionId = catalogueNameIndex.get(name.toLowerCase());
  if (!factionId) return undefined;
  return factionRegistry.get(factionId);
}

export function getDetachmentsForFaction(factionId: string): Detachment[] {
  return factionRegistry.get(factionId)?.detachments ?? [];
}

export function getAllFactions(): FactionDefinition[] {
  return Array.from(factionRegistry.values());
}
