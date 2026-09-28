import { useGameStore } from './storeContext';
import { Lobby } from './lobby/Lobby';
import { GameView } from './game/GameView';

/**
 * Route between Lobby and Game. The game view takes over once both rosters
 * are in (setup continues there: roll-off, deployment); spectators go
 * straight to the board.
 */
export function App() {
  const roomId = useGameStore((s) => s.roomId);
  const game = useGameStore((s) => s.game);
  const spectator = useGameStore((s) => s.spectator);

  const rostersPending =
    game?.phase === 'setup' &&
    game.setup !== null &&
    !(game.setup.rostersLoaded[0] && game.setup.rostersLoaded[1]);

  const showGame = roomId !== null && game !== null && (spectator || !rostersPending);
  return showGame ? <GameView /> : <Lobby />;
}
