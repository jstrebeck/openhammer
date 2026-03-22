import { useGameStore } from '../store/gameStore';

interface DeploymentPreset {
  name: string;
  zones: { label: string; playerIndex: number; polygon: (bw: number, bh: number) => { x: number; y: number }[] }[];
}

const PRESETS: DeploymentPreset[] = [
  {
    name: 'Dawn of War (long edges)',
    zones: [
      {
        label: 'Player 1 DZ',
        playerIndex: 0,
        polygon: (bw, bh) => [
          { x: 0, y: 0 },
          { x: bw, y: 0 },
          { x: bw, y: bh * 0.25 },
          { x: 0, y: bh * 0.25 },
        ],
      },
      {
        label: 'Player 2 DZ',
        playerIndex: 1,
        polygon: (bw, bh) => [
          { x: 0, y: bh * 0.75 },
          { x: bw, y: bh * 0.75 },
          { x: bw, y: bh },
          { x: 0, y: bh },
        ],
      },
    ],
  },
  {
    name: 'Hammer and Anvil (short edges)',
    zones: [
      {
        label: 'Player 1 DZ',
        playerIndex: 0,
        polygon: (bw, bh) => [
          { x: 0, y: 0 },
          { x: bw * 0.25, y: 0 },
          { x: bw * 0.25, y: bh },
          { x: 0, y: bh },
        ],
      },
      {
        label: 'Player 2 DZ',
        playerIndex: 1,
        polygon: (bw, bh) => [
          { x: bw * 0.75, y: 0 },
          { x: bw, y: 0 },
          { x: bw, y: bh },
          { x: bw * 0.75, y: bh },
        ],
      },
    ],
  },
  {
    name: 'Search and Destroy (diagonal quarters)',
    zones: [
      {
        label: 'Player 1 DZ',
        playerIndex: 0,
        polygon: (bw, bh) => [
          { x: 0, y: 0 },
          { x: bw * 0.5, y: 0 },
          { x: 0, y: bh * 0.5 },
        ],
      },
      {
        label: 'Player 2 DZ',
        playerIndex: 1,
        polygon: (bw, bh) => [
          { x: bw, y: bh },
          { x: bw * 0.5, y: bh },
          { x: bw, y: bh * 0.5 },
        ],
      },
    ],
  },
];

export function DeploymentZonePanel() {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const players = Object.values(gameState.players);
  const hasZones = Object.keys(gameState.deploymentZones).length > 0;

  const handleApplyPreset = (preset: DeploymentPreset) => {
    // Remove existing zones
    for (const id of Object.keys(gameState.deploymentZones)) {
      dispatch({ type: 'REMOVE_DEPLOYMENT_ZONE', payload: { zoneId: id } });
    }

    const bw = gameState.board.width;
    const bh = gameState.board.height;

    for (const zoneDef of preset.zones) {
      const player = players[zoneDef.playerIndex];
      dispatch({
        type: 'ADD_DEPLOYMENT_ZONE',
        payload: {
          zone: {
            id: crypto.randomUUID(),
            playerId: player?.id ?? '',
            polygon: zoneDef.polygon(bw, bh),
            label: zoneDef.label,
            color: player?.color ?? '#888888',
          },
        },
      });
    }
  };

  const handleClear = () => {
    for (const id of Object.keys(gameState.deploymentZones)) {
      dispatch({ type: 'REMOVE_DEPLOYMENT_ZONE', payload: { zoneId: id } });
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1">Deployment Zones</div>
      {PRESETS.map((preset) => (
        <button
          key={preset.name}
          onClick={() => handleApplyPreset(preset)}
          className="w-full text-left px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        >
          {preset.name}
        </button>
      ))}
      {hasZones && (
        <button
          onClick={handleClear}
          className="w-full text-left px-2 py-1.5 rounded text-sm text-red-400 hover:bg-gray-700 transition-colors"
        >
          Clear Zones
        </button>
      )}
    </div>
  );
}
