import type { DiceRoll } from '../types/index';

/** Roll a pool of dice and return a DiceRoll result */
export function rollDice(
  count: number,
  sides: number,
  purpose: string,
  threshold?: number,
): DiceRoll {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) {
    dice.push(Math.floor(Math.random() * sides) + 1);
  }

  return {
    id: crypto.randomUUID(),
    dice,
    sides,
    threshold,
    purpose,
    timestamp: Date.now(),
  };
}

/** Count how many dice in a roll meet or exceed the threshold */
export function countSuccesses(roll: DiceRoll): number {
  if (roll.threshold == null) return roll.dice.length;
  return roll.dice.filter((d) => d >= roll.threshold!).length;
}

/** Count failures */
export function countFailures(roll: DiceRoll): number {
  return roll.dice.length - countSuccesses(roll);
}

/** Sum all dice */
export function sumDice(roll: DiceRoll): number {
  return roll.dice.reduce((a, b) => a + b, 0);
}
