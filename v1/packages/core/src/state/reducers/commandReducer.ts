import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';

export const commandReducer: SubReducer = (state, action) => {
  switch (action.type) {
    // ===== Phase 12: Command Phase & Battle-shock =====

    case 'START_COMMAND_PHASE': {
      const playerIds = Object.keys(state.players);
      let newState = { ...state };

      // Both players gain 1 CP
      for (const playerId of playerIds) {
        const player = newState.players[playerId];
        if (player) {
          newState = {
            ...newState,
            players: {
              ...newState.players,
              [playerId]: { ...player, commandPoints: player.commandPoints + 1 },
            },
            log: appendLog(newState.log, {
              type: 'cp_change',
              playerId,
              oldValue: player.commandPoints,
              newValue: player.commandPoints + 1,
              reason: 'Command Phase CP gain',
              timestamp: Date.now(),
            }),
          };
        }
      }

      // Clear battle-shocked status for the active player's units
      // (Battle-shock clears at start of owning player's next Command Phase)
      const activePlayerId = newState.turnState.activePlayerId;
      const clearedShocked = newState.battleShocked.filter((unitId) => {
        const unit = newState.units[unitId];
        return unit && unit.playerId !== activePlayerId;
      });

      newState = { ...newState, battleShocked: clearedShocked, gameStarted: true };

      return newState;
    }

    case 'RESOLVE_BATTLE_SHOCK': {
      const { unitId, roll, passed } = action.payload;
      const unit = state.units[unitId];
      if (!unit) return state;

      let newState = {
        ...state,
        log: appendLog(state.log, { type: 'dice_roll', roll, timestamp: Date.now() }),
      };

      if (passed) {
        newState = {
          ...newState,
          log: appendLog(newState.log, {
            type: 'message',
            text: `${unit.name} passes Battle-shock test`,
            timestamp: Date.now(),
          }),
        };
      } else {
        // Unit becomes Battle-shocked
        newState = {
          ...newState,
          battleShocked: [...newState.battleShocked.filter((id) => id !== unitId), unitId],
          log: appendLog(newState.log, {
            type: 'message',
            text: `${unit.name} fails Battle-shock test — Battle-shocked! (OC becomes 0)`,
            timestamp: Date.now(),
          }),
        };
      }

      return newState;
    }

    case 'SET_COMMAND_POINTS': {
      const { playerId, value, reason } = action.payload;
      const player = state.players[playerId];
      if (!player) return state;

      let clamped = Math.max(0, value);
      let newCpGained = { ...state.cpGainedThisRound };

      // CP cap: max 1 additional CP per battle round from non-Command-Phase sources
      if (clamped > player.commandPoints) {
        const cpGain = clamped - player.commandPoints;
        const alreadyGained = newCpGained[playerId] ?? 0;
        if (alreadyGained >= 1) {
          // Already gained max non-Command-Phase CP this round — cap it
          clamped = player.commandPoints;
          return {
            ...state,
            log: appendLog(state.log, {
              type: 'message',
              text: `[BLOCKED] ${player.name} cannot gain more CP this battle round (CP cap: +1 per round)`,
              timestamp: Date.now(),
            }),
          };
        }
        const allowedGain = Math.min(cpGain, 1 - alreadyGained);
        clamped = player.commandPoints + allowedGain;
        newCpGained = { ...newCpGained, [playerId]: alreadyGained + allowedGain };
      }

      return {
        ...state,
        players: {
          ...state.players,
          [playerId]: { ...player, commandPoints: clamped },
        },
        cpGainedThisRound: newCpGained,
        log: appendLog(state.log, {
          type: 'cp_change',
          playerId,
          oldValue: player.commandPoints,
          newValue: clamped,
          reason,
          timestamp: Date.now(),
        }),
      };
    }

    default:
      return null; // this reducer doesn't handle this action
  }
};
