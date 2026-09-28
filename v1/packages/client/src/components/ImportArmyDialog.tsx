import { useState, useRef } from 'react';
import { validateArmyList, buildArmyUnits, generateUUID } from '@openhammer/core';
import type { ArmyListValidationError, BattlescribeRoster, DeploymentZone } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { PLAYER_COLORS } from '../canvas/constants';

interface Props {
  onClose: () => void;
}

type Step = 'load' | 'zone' | 'done';

export function ImportArmyDialog({ onClose }: Props) {
  const [step, setStep] = useState<Step>('load');
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<ArmyListValidationError[]>([]);
  const [validatedRoster, setValidatedRoster] = useState<BattlescribeRoster | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gameState = useGameStore((s) => s.gameState);

  const deploymentZones = Object.values(gameState.deploymentZones);
  const hasZones = deploymentZones.length > 0;

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

    // If there are deployment zones, go to zone selection; otherwise deploy directly
    if (hasZones) {
      setStep('zone');
    } else {
      deployArmy(result.roster, null);
    }
  };

  const handleDeployInZone = () => {
    if (!validatedRoster || !selectedZoneId) return;
    const zone = gameState.deploymentZones[selectedZoneId];
    if (!zone) return;
    deployArmy(validatedRoster, zone);
  };

  const deployArmy = (roster: BattlescribeRoster, zone: DeploymentZone | null) => {
    const playerIds = Object.keys(gameState.players);
    const armyName = roster.roster.name ?? roster.roster.forces?.[0]?.catalogueName ?? 'Army';
    const nextColor = PLAYER_COLORS[playerIds.length % PLAYER_COLORS.length];

    // In multiplayer, use the existing player; in local, create a new one
    const mpPlayerId = useMultiplayerStore.getState().playerId;
    const mpRoomId = useMultiplayerStore.getState().roomId;
    let playerId: string;
    if (mpRoomId && mpPlayerId && gameState.players[mpPlayerId]) {
      playerId = mpPlayerId;
    } else {
      playerId = generateUUID();
      useGameStore.getState().dispatch({
        type: 'ADD_PLAYER',
        payload: { player: { id: playerId, name: armyName, color: nextColor, commandPoints: 0 } },
      });
    }

    // Compute bounds from zone polygon, or fall back to a default staging area
    let bounds: { x: number; y: number; width: number; height: number } | undefined;
    if (zone) {
      const xs = zone.polygon.map((p) => p.x);
      const ys = zone.polygon.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      // Add a small inset so models aren't right on the edge
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

    setStep('done');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[600px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">
            {step === 'load' && 'Import Army List'}
            {step === 'zone' && 'Select Deployment Zone'}
            {step === 'done' && 'Army Deployed'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Step 1: Load JSON */}
          {step === 'load' && (
            <>
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
                  rows={12}
                  className="w-full bg-gray-900 text-gray-200 rounded border border-gray-600 p-3 text-xs font-mono focus:outline-none focus:border-blue-500 resize-y"
                  placeholder='{"roster":{"forces":[{"selections":[...]}],...}}'
                  spellCheck={false}
                />
              </div>

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

          {/* Step 2: Select Deployment Zone */}
          {step === 'zone' && (
            <>
              <div className="text-sm text-gray-300">
                Select a deployment zone for this army. Models will be placed within the zone.
              </div>
              <div className="space-y-2">
                {deploymentZones.map((zone) => (
                  <button
                    key={zone.id}
                    onClick={() => setSelectedZoneId(zone.id)}
                    className={`w-full text-left px-4 py-3 rounded border transition-colors ${
                      selectedZoneId === zone.id
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />
                      <span className="text-sm font-medium text-white">{zone.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step 3: Done */}
          {step === 'done' && (
            <div className="bg-green-900/30 border border-green-700 rounded p-3">
              <div className="text-sm text-green-300">Army deployed successfully! Models have been placed in the deployment zone.</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          {step === 'load' && (
            <>
              <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm">
                Cancel
              </button>
              <button
                onClick={handleValidate}
                disabled={!jsonText.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {hasZones ? 'Next' : 'Import & Deploy'}
              </button>
            </>
          )}
          {step === 'zone' && (
            <>
              <button onClick={() => setStep('load')} className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm">
                Back
              </button>
              <button
                onClick={handleDeployInZone}
                disabled={!selectedZoneId}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Deploy Army
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
