import { useGameStore } from '../store/gameStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';

export function CommandPointTracker() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const roomId = useMultiplayerStore((s) => s.roomId);

  const players = Object.values(gameState.players);
  if (players.length === 0) return null;

  // Push down when multiplayer RoomInfo is showing above
  const topClass = roomId ? 'top-[160px]' : 'top-14';

  return (
    <div className={`absolute ${topClass} right-3 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 shadow-lg p-2 space-y-1`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">Command Points</div>
      {players.map((player) => (
        <div key={player.id} className="flex items-center gap-2 px-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: player.color }} />
          <span className="text-xs text-gray-300 flex-1 truncate max-w-[80px]">{player.name}</span>
          <button
            onClick={() =>
              dispatch({
                type: 'SET_COMMAND_POINTS',
                payload: { playerId: player.id, value: player.commandPoints - 1, reason: 'Spent' },
              })
            }
            className="w-5 h-5 rounded bg-red-800 hover:bg-red-700 text-white text-xs flex items-center justify-center"
          >
            -
          </button>
          <span className="text-sm font-bold text-white w-6 text-center">{player.commandPoints}</span>
          <button
            onClick={() =>
              dispatch({
                type: 'SET_COMMAND_POINTS',
                payload: { playerId: player.id, value: player.commandPoints + 1, reason: 'Gained' },
              })
            }
            className="w-5 h-5 rounded bg-green-800 hover:bg-green-700 text-white text-xs flex items-center justify-center"
          >
            +
          </button>
        </div>
      ))}
    </div>
  );
}
