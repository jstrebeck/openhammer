import { useUIStore } from './store/uiStore';
import { GameCreation } from './components/GameCreation';
import { GameLayout } from './components/GameLayout';

export function App() {
  const gameCreated = useUIStore((s) => s.gameCreated);

  if (!gameCreated) {
    return <GameCreation />;
  }

  return <GameLayout />;
}
