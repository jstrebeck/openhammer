export interface Phase {
  id: string;
  name: string;
}

export interface RulesEdition {
  id: string;
  name: string;
  gameSystem: string;
  phases: Phase[];

  getNextPhase(currentIndex: number): number | null;
  getMaxMoveDistance(moveCharacteristic: number, moveType: 'normal' | 'advance' | 'fall_back'): number;
  getEngagementRange(): number;
  getCoherencyRange(): number;
  getCoherencyMinModels(unitSize: number): number;
}
