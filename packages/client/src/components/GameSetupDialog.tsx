import { useState, useRef } from 'react';
import { validateArmyList, buildArmyUnits, MISSIONS, rollDice } from '@openhammer/core';
import type { ArmyListValidationError, BattlescribeRoster, Mission } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { PLAYER_COLORS } from '../canvas/constants';

type SetupStep = 'map' | 'rolloff' | 'import-attacker' | 'import-defender' | 'done';

export function GameSetupDialog() {
  const role = useMultiplayerStore((s) => s.role);
  const roomId = useMultiplayerStore((s) => s.roomId);
  const isMultiplayer = !!roomId;
  const isPlayer2 = role === 'player2';
  const isLocal = !isMultiplayer;

  // Player 2 in multiplayer skips straight to import (as defender)
  const initialStep: SetupStep = isPlayer2 ? 'import-defender' : 'map';
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

  // Roll-off state (local only — players don't exist yet during roll-off)
  const [rollResults, setRollResults] = useState<{ p1: number; p2: number } | null>(null);
  const [attackerPlayerIndex, setAttackerPlayerIndex] = useState<number | null>(null);

  // Import state
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<ArmyListValidationError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track created player IDs so we can assign roles later
  const createdPlayerIds = useRef<string[]>([]);

  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  // ─── Roll-off ───
  const handleRollOff = () => {
    const roll = rollDice(2, 6, 'Attacker/Defender Roll-off');
    const p1Roll = roll.dice[0];
    const p2Roll = roll.dice[1];
    setRollResults({ p1: p1Roll, p2: p2Roll });
    // Higher roll wins; ties go to player 1
    setAttackerPlayerIndex(p1Roll >= p2Roll ? 0 : 1);
  };

  // ─── File handling ───
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setJsonText(text);
    setErrors([]);
  };

  // ─── Import & deploy ───
  const handleValidate = (role: 'attacker' | 'defender') => {
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

    deployArmy(result.roster, role);
  };

  const deployArmy = (roster: BattlescribeRoster, role: 'attacker' | 'defender') => {
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

    // Track player ID for role assignment later
    createdPlayerIds.current.push(playerId);

    // Place in staging area outside the board
    const { board } = currentState;
    const stagingHeight = Math.max(10, board.height - 4);
    let bounds: { x: number; y: number; width: number; height: number };
    let startPosition: { x: number; y: number };
    let facing: number;

    if (role === 'attacker') {
      // Left of board
      startPosition = { x: -15, y: 2 };
      bounds = { x: -15, y: 2, width: 13, height: stagingHeight };
      facing = 90; // faces right toward board
    } else {
      // Right of board
      startPosition = { x: board.width + 2, y: 2 };
      bounds = { x: board.width + 2, y: 2, width: 13, height: stagingHeight };
      facing = 270; // faces left toward board
    }

    const units = buildArmyUnits(roster, playerId, startPosition, bounds, facing);
    useGameStore.getState().dispatch({
      type: 'IMPORT_ARMY',
      payload: { units },
    });

    // Reset form and advance to next step
    setJsonText('');
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (step === 'import-attacker') {
      setStep('import-defender');
    } else {
      setStep('done');
    }
  };

  // ─── Finalize and close ───
  const handleClose = () => {
    const currentState = useGameStore.getState().gameState;
    const playerIds = createdPlayerIds.current.length >= 2
      ? createdPlayerIds.current
      : Object.keys(currentState.players);

    // Assign attacker/defender roles if we have 2 players
    if (playerIds.length >= 2 && attackerPlayerIndex !== null) {
      const attackerId = playerIds[attackerPlayerIndex];
      const defenderId = playerIds[attackerPlayerIndex === 0 ? 1 : 0];

      dispatch({ type: 'DETERMINE_ATTACKER_DEFENDER', payload: { attackerId, defenderId } });

      // Re-dispatch mission to regenerate zones with correct playerIds
      if (selectedMission) {
        dispatch({ type: 'SET_MISSION', payload: { mission: selectedMission } });
      }

      // Begin alternating deployment with attacker going first
      dispatch({ type: 'BEGIN_DEPLOYMENT', payload: { firstDeployingPlayerId: attackerId } });
    }

    useUIStore.getState().setShowGameSetup(false);
    useUIStore.getState().setGameSetupComplete(true);
  };

  // ─── Step metadata ───
  const stepTitle = () => {
    switch (step) {
      case 'map': return 'Game Setup — Select Mission';
      case 'rolloff': return 'Game Setup — Roll Off';
      case 'import-attacker': return 'Game Setup — Import Attacker Army';
      case 'import-defender': return isPlayer2 ? 'Import Your Army' : 'Game Setup — Import Defender Army';
      case 'done': return 'Setup Complete';
    }
  };

  const totalSteps = 4;

  const stepNumber = (): number | null => {
    if (isPlayer2) return null;
    switch (step) {
      case 'map': return 1;
      case 'rolloff': return 2;
      case 'import-attacker': return 3;
      case 'import-defender': return 3;
      case 'done': return null;
    }
  };

  const isImportStep = step === 'import-attacker' || step === 'import-defender';
  const importRole = step === 'import-attacker' ? 'attacker' : 'defender';
  const importLabel = step === 'import-attacker' ? "Attacker's" : "Defender's";

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
          {/* Step: Mission Selection */}
          {step === 'map' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-300">
                Choose a mission for your game.
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Mission list */}
                <div className="space-y-2">
                  {MISSIONS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMission(m)}
                      className={`w-full text-left px-3 py-3 rounded border transition-colors ${
                        selectedMission?.id === m.id
                          ? 'border-blue-500 bg-blue-900/30'
                          : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                      }`}
                    >
                      <div className="text-sm font-medium text-white">{m.name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {m.battlefieldSize.width}" x {m.battlefieldSize.height}" | {m.maxBattleRounds} rounds | {m.objectivePlacements.length} objectives
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        First turn: {m.firstTurnRule === 'attacker_first' ? 'Attacker' : m.firstTurnRule === 'defender_first' ? 'Defender' : 'Roll-off'}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Mission preview */}
                <div>
                  {selectedMission ? (
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-white">{selectedMission.name}</div>

                      {/* Deployment map preview */}
                      <div className="bg-gray-900 rounded border border-gray-600 p-2">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Deployment Map</div>
                        <svg
                          viewBox={`0 0 ${selectedMission.battlefieldSize.width} ${selectedMission.battlefieldSize.height}`}
                          className="w-full h-auto"
                          style={{ maxHeight: '160px' }}
                        >
                          <rect width={selectedMission.battlefieldSize.width} height={selectedMission.battlefieldSize.height}
                            fill="#1a1a2e" stroke="#333" strokeWidth="0.5" />
                          {selectedMission.deploymentMap.map((zone, i) => (
                            <polygon
                              key={i}
                              points={zone.polygon.map(p => `${p.x},${p.y}`).join(' ')}
                              fill={zone.role === 'attacker' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)'}
                              stroke={zone.role === 'attacker' ? '#3b82f6' : '#ef4444'}
                              strokeWidth="0.5"
                            />
                          ))}
                          {selectedMission.objectivePlacements.map((obj) => (
                            <g key={obj.number}>
                              <circle cx={obj.position.x} cy={obj.position.y} r="1.5"
                                fill="#fbbf24" stroke="#fff" strokeWidth="0.3" />
                              <text x={obj.position.x} y={obj.position.y + 0.5}
                                textAnchor="middle" fill="#000" fontSize="2" fontWeight="bold">
                                {obj.number}
                              </text>
                            </g>
                          ))}
                        </svg>
                        <div className="flex gap-3 mt-2">
                          {selectedMission.deploymentMap.map((zone, i) => (
                            <div key={i} className="flex items-center gap-1 text-[10px]">
                              <span className={`w-2 h-2 rounded-sm ${zone.role === 'attacker' ? 'bg-blue-500' : 'bg-red-500'}`} />
                              <span className="text-gray-400">{zone.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Scoring conditions */}
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Scoring</div>
                        <div className="space-y-1">
                          {selectedMission.scoringConditions.map((sc) => (
                            <div key={sc.id} className="bg-gray-700/40 rounded px-2 py-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] px-1 rounded ${
                                  sc.type === 'primary' ? 'bg-blue-700/50 text-blue-300' : 'bg-purple-700/50 text-purple-300'
                                }`}>
                                  {sc.type}
                                </span>
                                <span className="text-xs text-white font-medium">{sc.name}</span>
                                <span className="text-[10px] text-yellow-400 ml-auto">{sc.vpAwarded} VP</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 text-center mt-8">
                      Select a mission to see details
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step: Roll-off */}
          {step === 'rolloff' && (
            <div className="space-y-4">
              <div className="text-sm text-gray-300">
                Roll off to determine Attacker and Defender. The winner chooses to attack or defend.
              </div>

              {!rollResults ? (
                <button
                  onClick={handleRollOff}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                >
                  Roll Off
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-8 justify-center">
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Player 1</div>
                      <div className={`text-4xl font-bold mt-1 ${
                        rollResults.p1 >= rollResults.p2 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {rollResults.p1}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Player 2</div>
                      <div className={`text-4xl font-bold mt-1 ${
                        rollResults.p2 > rollResults.p1 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {rollResults.p2}
                      </div>
                    </div>
                  </div>
                  <div className="text-center text-sm">
                    <span className="text-green-400 font-medium">
                      Player {(attackerPlayerIndex ?? 0) + 1}
                    </span>
                    {' wins and is the '}
                    <span className="text-blue-400 font-medium">Attacker</span>
                    {'. '}
                    <span className="text-red-400 font-medium">
                      Player {attackerPlayerIndex === 0 ? 2 : 1}
                    </span>
                    {' is the '}
                    <span className="text-red-400 font-medium">Defender</span>.
                  </div>
                  <button
                    onClick={() => {
                      // Swap roles
                      setAttackerPlayerIndex(attackerPlayerIndex === 0 ? 1 : 0);
                    }}
                    className="w-full px-3 py-1.5 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-xs"
                  >
                    Swap Attacker / Defender
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step: Import Army (attacker or defender) */}
          {isImportStep && (
            <>
              <div className="text-sm text-gray-300">
                {isPlayer2
                  ? 'Import your army list to join the game.'
                  : `Import the ${importLabel} army list.`}
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
                {isLocal ? 'Both armies ready for deployment!' : 'Army imported successfully!'}
              </div>
              <div className="text-xs text-green-400 mt-1">
                Models have been placed in staging areas beside the board. Drag them into your deployment zones during the deployment phase.
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
                onClick={() => {
                  if (selectedMission) {
                    dispatch({ type: 'SET_MISSION', payload: { mission: selectedMission } });
                  }
                  setStep('rolloff');
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Next
              </button>
            )}
            {step === 'rolloff' && (
              <>
                <button
                  onClick={() => setStep('map')}
                  className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('import-attacker')}
                  disabled={attackerPlayerIndex === null}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </>
            )}
            {step === 'import-attacker' && (
              <>
                <button
                  onClick={() => setStep('rolloff')}
                  className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    setJsonText('');
                    setErrors([]);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    setStep('import-defender');
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleValidate('attacker')}
                  disabled={!jsonText.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import & Deploy
                </button>
              </>
            )}
            {step === 'import-defender' && !isPlayer2 && (
              <>
                <button
                  onClick={() => handleClose()}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleValidate('defender')}
                  disabled={!jsonText.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import & Deploy
                </button>
              </>
            )}
            {step === 'import-defender' && isPlayer2 && (
              <>
                <button
                  onClick={() => handleClose()}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleValidate('defender')}
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
                Begin Deployment
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
