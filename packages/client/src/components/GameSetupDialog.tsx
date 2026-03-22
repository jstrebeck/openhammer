import { useState, useRef } from 'react';
import { validateArmyList, buildArmyUnits } from '@openhammer/core';
import type { ArmyListValidationError, BattlescribeRoster, DeploymentZone } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { PLAYER_COLORS } from '../canvas/constants';

interface DeploymentPreset {
  name: string;
  description: string;
  zones: { label: string; playerIndex: number; polygon: (bw: number, bh: number) => { x: number; y: number }[] }[];
}

const PRESETS: DeploymentPreset[] = [
  {
    name: 'Dawn of War',
    description: 'Long edges — each player deploys along a long board edge',
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
    name: 'Hammer and Anvil',
    description: 'Short edges — each player deploys along a short board edge',
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
    name: 'Search and Destroy',
    description: 'Diagonal quarters — each player deploys in opposite corners',
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

type SetupStep = 'map' | 'deployment' | 'import' | 'done';

export function GameSetupDialog() {
  const role = useMultiplayerStore((s) => s.role);
  const roomId = useMultiplayerStore((s) => s.roomId);
  const isMultiplayer = !!roomId;
  const isPlayer2 = role === 'player2';
  const isLocal = !isMultiplayer;

  // Player 2 in multiplayer skips straight to import
  const initialStep: SetupStep = isPlayer2 ? 'import' : 'map';
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  // Track which player is importing (0 = player 1, 1 = player 2) — only used for local games
  const [playerImportIndex, setPlayerImportIndex] = useState(0);

  // Import state
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<ArmyListValidationError[]>([]);
  const [validatedRoster, setValidatedRoster] = useState<BattlescribeRoster | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);
  const deploymentZones = Object.values(gameState.deploymentZones);

  const handleApplyPreset = (preset: DeploymentPreset) => {
    // Remove existing zones
    for (const id of Object.keys(gameState.deploymentZones)) {
      dispatch({ type: 'REMOVE_DEPLOYMENT_ZONE', payload: { zoneId: id } });
    }

    const bw = gameState.board.width;
    const bh = gameState.board.height;
    const players = Object.values(gameState.players);

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

    setSelectedPreset(preset.name);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonText(text);
    setErrors([]);
  };

  const handleValidate = () => {
    setErrors([]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setErrors([{ path: '', message: 'Invalid JSON — check for syntax errors' }]);
      return;
    }

    const result = validateArmyList(parsed);
    if (!result.valid || !result.roster) {
      setErrors(result.errors);
      return;
    }

    setValidatedRoster(result.roster);

    // If zones exist, pick one; otherwise deploy directly
    const currentZones = Object.values(useGameStore.getState().gameState.deploymentZones);
    if (currentZones.length > 0) {
      // Auto-select the first unoccupied zone for convenience
      const playerIds = Object.keys(useGameStore.getState().gameState.players);
      const occupiedZonePlayerIds = new Set(playerIds);
      const availableZone = currentZones.find((z) => !occupiedZonePlayerIds.has(z.playerId) || currentZones.length <= 2);
      if (availableZone && !selectedZoneId) {
        setSelectedZoneId(availableZone.id);
      }
      deployArmy(result.roster, selectedZoneId ? useGameStore.getState().gameState.deploymentZones[selectedZoneId] ?? null : availableZone ?? null);
    } else {
      deployArmy(result.roster, null);
    }
  };

  const deployArmy = (roster: BattlescribeRoster, zone: DeploymentZone | null) => {
    const currentState = useGameStore.getState().gameState;
    const playerIds = Object.keys(currentState.players);
    const armyName = roster.roster.name ?? roster.roster.forces?.[0]?.catalogueName ?? 'Army';
    const nextColor = PLAYER_COLORS[playerIds.length % PLAYER_COLORS.length];

    // In multiplayer, use the existing player created at room join; in local, create a new one
    const mpPlayerId = useMultiplayerStore.getState().playerId;
    let playerId: string;
    if (isMultiplayer && mpPlayerId && currentState.players[mpPlayerId]) {
      playerId = mpPlayerId;
    } else {
      playerId = crypto.randomUUID();
      useGameStore.getState().dispatch({
        type: 'ADD_PLAYER',
        payload: { player: { id: playerId, name: armyName, color: nextColor, commandPoints: 0 } },
      });
    }

    let bounds: { x: number; y: number; width: number; height: number } | undefined;
    if (zone) {
      const xs = zone.polygon.map((p) => p.x);
      const ys = zone.polygon.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const inset = 1;
      bounds = {
        x: minX + inset,
        y: minY + inset,
        width: Math.max(3, maxX - minX - inset * 2),
        height: Math.max(3, maxY - minY - inset * 2),
      };
    }

    const startPosition = bounds
      ? { x: bounds.x, y: bounds.y }
      : { x: 5, y: 5 + playerIds.length * 15 };

    // Player 1 faces right (90°), Player 2 faces left (270°)
    const facing = playerIds.length === 0 ? 90 : 270;
    const units = buildArmyUnits(roster, playerId, startPosition, bounds, facing);
    useGameStore.getState().dispatch({
      type: 'IMPORT_ARMY',
      payload: { units },
    });

    // Local game: after player 1, reset form for player 2
    if (isLocal && playerImportIndex === 0) {
      setPlayerImportIndex(1);
      setJsonText('');
      setErrors([]);
      setValidatedRoster(null);
      setSelectedZoneId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Stay on import step for player 2
      return;
    }

    setStep('done');
  };

  const handleClose = () => {
    useUIStore.getState().setShowGameSetup(false);
    useUIStore.getState().setGameSetupComplete(true);
  };

  const playerLabel = isLocal
    ? `Player ${playerImportIndex + 1}`
    : isPlayer2 ? 'Your' : 'Your';

  const stepTitle = () => {
    switch (step) {
      case 'map': return 'Game Setup — Select Map';
      case 'deployment': return 'Game Setup — Deployment Zones';
      case 'import': return isPlayer2 ? 'Import Your Army' : `Game Setup — Import ${playerLabel} Army`;
      case 'done': return 'Setup Complete';
    }
  };

  const totalSteps = isLocal ? 4 : 3;

  const stepNumber = () => {
    if (isPlayer2) return null;
    switch (step) {
      case 'map': return 1;
      case 'deployment': return 2;
      case 'import': return isLocal ? 3 + playerImportIndex : 3;
      case 'done': return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[640px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-medium text-white">{stepTitle()}</h2>
            {stepNumber() && (
              <div className="flex items-center gap-1.5 mt-1">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
                  <div
                    key={n}
                    className={`h-1 rounded-full transition-colors ${
                      n <= (stepNumber() ?? 0) ? 'bg-blue-500 w-8' : 'bg-gray-600 w-8'
                    }`}
                  />
                ))}
                <span className="text-xs text-gray-500 ml-2">Step {stepNumber()} of {totalSteps}</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Step: Map Selection */}
          {step === 'map' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-300">
                Choose a map for your game.
              </div>
              <div className="border border-dashed border-gray-600 rounded-lg p-8 text-center">
                <div className="text-gray-500 text-sm">
                  Map selection coming soon
                </div>
                <div className="text-gray-600 text-xs mt-2">
                  Default board ({gameState.board.width}" x {gameState.board.height}") will be used
                </div>
              </div>
            </div>
          )}

          {/* Step: Deployment Zones */}
          {step === 'deployment' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-300">
                Select a deployment zone layout for this game.
              </div>
              <div className="space-y-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleApplyPreset(preset)}
                    className={`w-full text-left px-4 py-3 rounded border transition-colors ${
                      selectedPreset === preset.name
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                    }`}
                  >
                    <div className="text-sm font-medium text-white">{preset.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{preset.description}</div>
                  </button>
                ))}
              </div>
              {selectedPreset && (
                <div className="text-xs text-green-400">
                  "{selectedPreset}" deployment zones applied
                </div>
              )}
            </div>
          )}

          {/* Step: Import Army */}
          {step === 'import' && (
            <>
              <div className="text-sm text-gray-300">
                {isPlayer2
                  ? 'Import your army list to join the game.'
                  : isLocal
                    ? `Import the army list for ${playerLabel}.`
                    : 'Import your army list.'}
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFile}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm"
                >
                  Load .json file
                </button>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Or paste JSON:</label>
                <textarea
                  value={jsonText}
                  onChange={(e) => { setJsonText(e.target.value); setErrors([]); }}
                  rows={10}
                  className="w-full bg-gray-900 text-gray-200 rounded border border-gray-600 p-3 text-xs font-mono focus:outline-none focus:border-blue-500 resize-y"
                  placeholder='{"roster":{"forces":[{"selections":[...]}],...}}'
                  spellCheck={false}
                />
              </div>

              {/* Zone selection if zones exist */}
              {deploymentZones.length > 0 && (
                <div>
                  <label className="block text-sm text-gray-300 mb-2">Deploy into zone:</label>
                  <div className="flex gap-2">
                    {deploymentZones.map((zone) => (
                      <button
                        key={zone.id}
                        onClick={() => setSelectedZoneId(zone.id)}
                        className={`flex-1 px-3 py-2 rounded border transition-colors ${
                          selectedZoneId === zone.id
                            ? 'border-blue-500 bg-blue-900/30'
                            : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />
                          <span className="text-xs font-medium text-white">{zone.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {errors.length > 0 && (
                <div className="bg-red-900/30 border border-red-700 rounded p-3">
                  <div className="text-sm text-red-300 font-medium mb-1">Validation errors:</div>
                  <ul className="text-xs text-red-200 space-y-1">
                    {errors.map((err, i) => (
                      <li key={i}>
                        {err.path && <span className="text-red-400 font-mono">{err.path}: </span>}
                        {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="bg-green-900/30 border border-green-700 rounded p-4">
              <div className="text-sm text-green-300 font-medium">
                {isLocal ? 'Both armies deployed successfully!' : 'Army deployed successfully!'}
              </div>
              <div className="text-xs text-green-400 mt-1">
                Models have been placed on the board.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-gray-700">
          <div>
            {step === 'map' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Skip Setup
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'map' && (
              <button
                onClick={() => setStep('deployment')}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Next
              </button>
            )}
            {step === 'deployment' && (
              <>
                <button
                  onClick={() => setStep('map')}
                  className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('import')}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Next
                </button>
              </>
            )}
            {step === 'import' && (
              <>
                {!isPlayer2 && playerImportIndex === 0 && (
                  <button
                    onClick={() => setStep('deployment')}
                    className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => {
                    // Local game player 1 skip: advance to player 2
                    if (isLocal && playerImportIndex === 0) {
                      setPlayerImportIndex(1);
                      setJsonText('');
                      setErrors([]);
                      setValidatedRoster(null);
                      setSelectedZoneId(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      return;
                    }
                    handleClose();
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleValidate}
                  disabled={!jsonText.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import & Deploy
                </button>
              </>
            )}
            {step === 'done' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Start Game
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
