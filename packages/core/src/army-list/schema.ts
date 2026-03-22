/**
 * Battlescribe JSON export types.
 * These mirror the structure produced by Battlescribe's JSON export.
 * Only the fields we actually use are typed; the rest is ignored.
 */

export interface BattlescribeRoster {
  roster: {
    costs?: BattlescribeCost[];
    costLimits?: BattlescribeCost[];
    forces?: BattlescribeForce[];
    name?: string;
    [key: string]: unknown;
  };
}

export interface BattlescribeForce {
  selections?: BattlescribeSelection[];
  name?: string;
  catalogueName?: string;
  [key: string]: unknown;
}

export interface BattlescribeSelection {
  id?: string;
  name: string;
  number?: number;
  type: 'model' | 'unit' | 'upgrade';
  costs?: BattlescribeCost[];
  categories?: BattlescribeCategory[];
  profiles?: BattlescribeProfile[];
  selections?: BattlescribeSelection[];
  rules?: BattlescribeRule[];
  [key: string]: unknown;
}

export interface BattlescribeCost {
  name: string;
  typeId?: string;
  value: number;
}

export interface BattlescribeCategory {
  id?: string;
  name: string;
  entryId?: string;
  primary: boolean;
}

export interface BattlescribeProfile {
  id?: string;
  name: string;
  typeName: string;
  hidden?: boolean;
  characteristics: BattlescribeCharacteristic[];
  [key: string]: unknown;
}

export interface BattlescribeCharacteristic {
  '$text': string;
  name: string;
  typeId?: string;
}

export interface BattlescribeRule {
  id?: string;
  name: string;
  description: string;
  hidden?: boolean;
  [key: string]: unknown;
}

export interface ArmyListValidationError {
  path: string;
  message: string;
}
