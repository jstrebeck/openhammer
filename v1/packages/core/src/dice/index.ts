import type { DiceRoll } from '../types/index';
import { generateUUID } from '../utils/uuid';

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
    id: generateUUID(),
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

/** Check if a DiceRoll can be re-rolled (not already a re-roll) */
export function canReRoll(roll: DiceRoll): boolean {
  return !roll.reRolled;
}

/** Perform a roll-off: both players roll 1D6, highest wins. Ties re-roll. No modifiers/re-rolls. */
export function rollOff(
  player1Id: string,
  player2Id: string,
): { winnerId: string; rolls: DiceRoll[] } {
  const allRolls: DiceRoll[] = [];

  let winner: string | null = null;
  while (winner === null) {
    const roll1 = rollDice(1, 6, 'Roll-off');
    const roll2 = rollDice(1, 6, 'Roll-off');
    allRolls.push(roll1, roll2);

    const val1 = roll1.dice[0];
    const val2 = roll2.dice[0];
    if (val1 > val2) winner = player1Id;
    else if (val2 > val1) winner = player2Id;
    // tie: loop again
  }

  return { winnerId: winner, rolls: allRolls };
}
