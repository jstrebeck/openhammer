import { useState, useEffect, useRef, useCallback } from 'react';
import { validateArmyList, buildArmyUnits, MISSIONS, rollDice, detectFactionFromRoster, getDetachmentsForFaction, getFaction } from '@openhammer/core';
import type { ArmyListValidationError, BattlescribeRoster, Mission, Detachment } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { PositionedDetachmentTooltip } from './DetachmentTooltip';
import { useMultiplayerStore, multiplayerDisconnect } from '../networking/useMultiplayer';
import { PLAYER_COLORS } from '../canvas/constants';

type SetupStep = 'waiting' | 'waiting-for-host' | 'map' | 'rolloff' | 'import-attacker' | 'detachment-attacker' | 'import-defender' | 'detachment-defender' | 'done';

export function GameSetupDialog() {
  const role = useMultiplayerStore((s) => s.role);
  const roomId = useMultiplayerStore((s) => s.roomId);
  const isMultiplayer = !!roomId;
  const isPlayer2 = role === 'player2';
  const isLocal = !isMultiplayer;
  const isHost = isMultiplayer && role === 'player1';
  const mpPlayerId = useMultiplayerStore((s) => s.playerId);

  const gameState = useGameStore((s) => s.gameState);
  const myAssignedRole = gameState.attackerId === mpPlayerId ? 'attacker' : gameState.defenderId === mpPlayerId ? 'defender' : null;
  const dispatch = useGameStore((s) => s.dispatch);

  // Multiplayer host starts at 'waiting', player 2 waits for host, local starts at map
  const initialStep: SetupStep = isHost ? 'waiting' : isPlayer2 ? 'waiting-for-host' : 'map';
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);

  // Detect when opponent connects (host advances from waiting)
  const playerCount = Object.keys(gameState.players).length;
  useEffect(() => {
    if (step === 'waiting' && playerCount >= 2) {
      setStep('map');
    }
  }, [step, playerCount]);

  // Detect when host completes roll-off (player 2 advances from waiting-for-host)
  const attackerIdSet = !!gameState.attackerId;
  useEffect(() => {
    if (step === 'waiting-for-host' && attackerIdSet) {
      setStep('import-defender');
    }
  }, [step, attackerIdSet]);

  // Player names — entered manually for local, derived from game state for multiplayer
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const players = Object.values(gameState.players);
  const resolvedP1Name = isMultiplayer ? (players[0]?.name ?? 'Player 1') : (player1Name || 'Player 1');
  const resolvedP2Name = isMultiplayer ? (players[1]?.name ?? 'Player 2') : (player2Name || 'Player 2');

  // Roll-off state (local only — players don't exist yet during roll-off)
  const [rollResults, setRollResults] = useState<{ p1: number; p2: number } | null>(null);
  const [attackerPlayerIndex, setAttackerPlayerIndex] = useState<number | null>(null);

  // Import state
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<ArmyListValidationError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track created player IDs so we can assign roles later
  const createdPlayerIds = useRef<string[]>([]);

  // Detachment selection state
  const [attackerFactionId, setAttackerFactionId] = useState<string | undefined>();
  const [defenderFactionId, setDefenderFactionId] = useState<string | undefined>();
  const [selectedDetachmentId, setSelectedDetachmentId] = useState<string | null>(null);
  const [hoveredDetachment, setHoveredDetachment] = useState<Detachment | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const hoverDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDetachmentHover = useCallback((detachment: Detachment, e: React.MouseEvent) => {
    if (hoverDismissTimer.current) { clearTimeout(hoverDismissTimer.current); hoverDismissTimer.current = null; }
    const targetRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHoveredDetachment(detachment);
    setHoverPos({ x: targetRect.right + 8, y: targetRect.top });
  }, []);

  const handleDetachmentHoverLeave = useCallback(() => {
    hoverDismissTimer.current = setTimeout(() => setHoveredDetachment(null), 150);
  }, []);

  const handleTooltipMouseEnter = useCallback(() => {
    if (hoverDismissTimer.current) { clearTimeout(hoverDismissTimer.current); hoverDismissTimer.current = null; }
  }, []);

  const handleTooltipMouseLeave = useCallback(() => {
    hoverDismissTimer.current = setTimeout(() => setHoveredDetachment(null), 150);
  }, []);

  // ─── Roll-off ───
  const handleRollOff = () => {
    let p1Roll: number;
    let p2Roll: number;
    do {
      const roll = rollDice(2, 6, 'Attacker/Defender Roll-off');
      p1Roll = roll.dice[0];
      p2Roll = roll.dice[1];
    } while (p1Roll === p2Roll);
    setRollResults({ p1: p1Roll, p2: p2Roll });
    setAttackerPlayerIndex(p1Roll > p2Roll ? 0 : 1);
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
    const nextColor = PLAYER_COLORS[playerIds.length % PLAYER_COLORS.length];

    // Determine player name: use entered names for local games, existing player name for multiplayer
    let playerName: string;
    if (isLocal && attackerPlayerIndex !== null) {
      if (role === 'attacker') {
        playerName = attackerPlayerIndex === 0 ? resolvedP1Name : resolvedP2Name;
      } else {
        playerName = attackerPlayerIndex === 0 ? resolvedP2Name : resolvedP1Name;
      }
    } else {
      playerName = roster.roster.name ?? roster.roster.forces?.[0]?.catalogueName ?? 'Army';
    }

    // In multiplayer, use the existing player created at room join; in local, create a new one
    const mpPlayerId = useMultiplayerStore.getState().playerId;
    let playerId: string;
    if (isMultiplayer && mpPlayerId && currentState.players[mpPlayerId]) {
      playerId = mpPlayerId;
    } else {
      playerId = crypto.randomUUID();
      useGameStore.getState().dispatch({
        type: 'ADD_PLAYER',
        payload: { player: { id: playerId, name: playerName, color: nextColor, commandPoints: 0 } },
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

    // Detect faction and set faction keyword
    const detectedFactionId = detectFactionFromRoster(roster);
    if (detectedFactionId) {
      const faction = getFaction(detectedFactionId);
      if (faction) {
        useGameStore.getState().dispatch({
          type: 'SET_FACTION_KEYWORD',
          payload: { playerId, keyword: faction.factionKeyword },
        });
      }
    }

    // Reset form
    setJsonText('');
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Advance to detachment step or skip if no detachments
    // In multiplayer, host only imports their own army — skip to 'done' after attacker
    const nextAfterAttacker = isMultiplayer ? 'done' : 'import-defender';
    if (step === 'import-attacker') {
      if (detectedFactionId && getDetachmentsForFaction(detectedFactionId).length > 0) {
        setAttackerFactionId(detectedFactionId);
        setSelectedDetachmentId(null);
        setStep('detachment-attacker');
      } else {
        setStep(nextAfterAttacker);
      }
    } else {
      if (detectedFactionId && getDetachmentsForFaction(detectedFactionId).length > 0) {
        setDefenderFactionId(detectedFactionId);
        setSelectedDetachmentId(null);
        setStep('detachment-defender');
      } else {
        setStep('done');
      }
    }
  };

  // ─── Detachment selection helpers ───
  const currentDetachmentFactionId = step === 'detachment-attacker' ? attackerFactionId : defenderFactionId;
  const currentDetachmentPlayerId = step === 'detachment-attacker'
    ? createdPlayerIds.current[createdPlayerIds.current.length - (step === 'detachment-attacker' ? 1 : 1)]
    : createdPlayerIds.current[createdPlayerIds.current.length - 1];

  const handleDetachmentSelect = (detachment: Detachment) => {
    if (!currentDetachmentPlayerId) return;
    dispatch({ type: 'SELECT_DETACHMENT', payload: { playerId: currentDetachmentPlayerId, detachment } });
    setSelectedDetachmentId(detachment.id);
  };

  const handleDetachmentContinue = () => {
    if (step === 'detachment-attacker') {
      setSelectedDetachmentId(null);
      // In multiplayer, host only imports their own army — skip defender import
      setStep(isMultiplayer ? 'done' : 'import-defender');
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
    // In multiplayer, roles were already assigned at rolloff time — skip
    if (!isMultiplayer && playerIds.length >= 2 && attackerPlayerIndex !== null) {
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

    // In multiplayer, begin deployment using the already-assigned attackerId
    if (isMultiplayer && currentState.attackerId) {
      dispatch({ type: 'BEGIN_DEPLOYMENT', payload: { firstDeployingPlayerId: currentState.attackerId } });
    }

    useUIStore.getState().setShowGameSetup(false);
    useUIStore.getState().setGameSetupComplete(true);
  };

  // ─── Step metadata ───
  const isDetachmentStep = step === 'detachment-attacker' || step === 'detachment-defender';

  const stepTitle = () => {
    switch (step) {
      case 'waiting': return 'Waiting for Opponent';
      case 'waiting-for-host': return 'Waiting for Host';
      case 'map': return 'Game Setup — Select Mission';
      case 'rolloff': return 'Game Setup — Roll Off';
      case 'import-attacker': return 'Game Setup — Import Attacker Army';
      case 'detachment-attacker': return 'Game Setup — Select Attacker Detachment';
      case 'import-defender': return isPlayer2 ? `Import ${myAssignedRole === 'attacker' ? 'Attacker' : 'Defender'} Army` : 'Game Setup — Import Defender Army';
      case 'detachment-defender': return isPlayer2 ? 'Select Your Detachment' : 'Game Setup — Select Defender Detachment';
      case 'done': return 'Setup Complete';
    }
  };

  const totalSteps = isPlayer2 ? 3 : isHost ? 6 : 5;

  const stepNumber = (): number | null => {
    switch (step) {
      case 'waiting': return 1;
      case 'waiting-for-host': return 1;
      case 'map': return isHost ? 2 : 1;
      case 'rolloff': return isHost ? 3 : 2;
      case 'import-attacker': return isHost ? 4 : 3;
      case 'detachment-attacker': return isHost ? 4 : 3;
      case 'import-defender': return isPlayer2 ? 2 : isHost ? 5 : 4;
      case 'detachment-defender': return isPlayer2 ? 2 : isHost ? 5 : 4;
      case 'done': return null;
    }
  };

  const isImportStep = step === 'import-attacker' || step === 'import-defender';
  const importRole = step === 'import-attacker' ? 'attacker' : 'defender';
  const importLabel = step === 'import-attacker' ? "Attacker's" : "Defender's";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div ref={dialogRef} className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[640px] max-h-[85vh] flex flex-col relative">
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
          {/* Step: Waiting for Opponent (multiplayer host only) */}
          {step === 'waiting' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              <div className="text-sm text-gray-300 text-center">
                Share this room code with your opponent so they can join.
              </div>

              {/* Room code display */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider">Room Code</div>
                <button
                  onClick={() => {
                    if (roomId) {
                      navigator.clipboard.writeText(roomId);
                      setRoomCodeCopied(true);
                      setTimeout(() => setRoomCodeCopied(false), 2000);
                    }
                  }}
                  className="px-6 py-3 bg-gray-900 border-2 border-blue-500 rounded-lg hover:bg-gray-800 transition-colors group"
                  title="Click to copy"
                >
                  <span className="text-3xl font-mono font-bold text-white tracking-[0.3em]">
                    {roomId}
                  </span>
                </button>
                <div className="text-xs text-gray-500">
                  {roomCodeCopied ? (
                    <span className="text-green-400">Copied to clipboard!</span>
                  ) : (
                    'Click to copy'
                  )}
                </div>
              </div>

              {/* Spinner */}
              <div className="flex items-center gap-3 text-gray-400">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">Waiting for opponent to connect...</span>
              </div>
            </div>
          )}

          {/* Step: Waiting for Host (player 2 only) */}
          {step === 'waiting-for-host' && (
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
              <div className="text-sm text-gray-300 text-center">
                The host is selecting the mission and determining attacker/defender roles.
              </div>

              <div className="flex items-center gap-3 text-gray-400">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">Waiting for host to complete setup...</span>
              </div>

              <div className="text-xs text-gray-500 text-center">
                You'll be able to import your army once roles have been assigned.
              </div>
            </div>
          )}

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
                {isLocal
                  ? 'Enter player names, then roll off to determine Attacker and Defender.'
                  : 'Roll off to determine Attacker and Defender.'}
              </div>

              {/* Player name inputs — local only */}
              {isLocal && (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Player 1</label>
                    <input
                      type="text"
                      value={player1Name}
                      onChange={(e) => setPlayer1Name(e.target.value)}
                      placeholder="Player 1"
                      className="w-full bg-gray-900 text-gray-200 rounded border border-gray-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Player 2</label>
                    <input
                      type="text"
                      value={player2Name}
                      onChange={(e) => setPlayer2Name(e.target.value)}
                      placeholder="Player 2"
                      className="w-full bg-gray-900 text-gray-200 rounded border border-gray-600 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

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
                      <div className="text-xs text-gray-400">{resolvedP1Name}</div>
                      <div className={`text-4xl font-bold mt-1 ${
                        rollResults.p1 >= rollResults.p2 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {rollResults.p1}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">{resolvedP2Name}</div>
                      <div className={`text-4xl font-bold mt-1 ${
                        rollResults.p2 > rollResults.p1 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {rollResults.p2}
                      </div>
                    </div>
                  </div>
                  <div className="text-center text-sm">
                    <span className="text-green-400 font-medium">
                      {attackerPlayerIndex === 0 ? resolvedP1Name : resolvedP2Name}
                    </span>
                    {' wins and is the '}
                    <span className="text-blue-400 font-medium">Attacker</span>
                    {'. '}
                    <span className="text-red-400 font-medium">
                      {attackerPlayerIndex === 0 ? resolvedP2Name : resolvedP1Name}
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
                  ? `You have been assigned as the ${myAssignedRole === 'attacker' ? 'Attacker' : 'Defender'}. Import your army list.`
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

          {/* Step: Detachment Selection */}
          {isDetachmentStep && currentDetachmentFactionId && (
            <div className="space-y-4">
              {(() => {
                const faction = getFaction(currentDetachmentFactionId);
                const detachments = getDetachmentsForFaction(currentDetachmentFactionId);
                return (
                  <>
                    <div className="text-sm text-gray-300">
                      Select a detachment for your {step === 'detachment-attacker' ? 'attacker' : 'defender'} army.
                    </div>

                    {/* Faction rule */}
                    {faction && (
                      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded p-3">
                        <div className="text-xs text-yellow-400 font-medium">Faction Rule: {faction.factionRuleName}</div>
                        <div className="text-[10px] text-gray-400 mt-1">{faction.factionRuleDescription}</div>
                      </div>
                    )}

                    {/* Detachment list */}
                    <div className="space-y-2">
                      {detachments.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => handleDetachmentSelect(d)}
                          onMouseEnter={(e) => handleDetachmentHover(d, e)}
                          onMouseLeave={handleDetachmentHoverLeave}
                          className={`w-full text-left px-3 py-3 rounded border transition-colors ${
                            selectedDetachmentId === d.id
                              ? 'border-blue-500 bg-blue-900/30'
                              : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                          }`}
                        >
                          <div className="text-sm font-medium text-white">{d.name}</div>
                          {d.rules && (
                            <div className="text-[10px] text-gray-400 mt-1 line-clamp-2">{d.rules}</div>
                          )}
                          <div className="flex gap-3 mt-1">
                            {d.stratagems && d.stratagems.length > 0 && (
                              <span className="text-[10px] text-indigo-400">
                                {d.stratagems.length} stratagem{d.stratagems.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {d.enhancements && d.enhancements.length > 0 && (
                              <span className="text-[10px] text-green-400">
                                {d.enhancements.length} enhancement{d.enhancements.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
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
            {(step === 'waiting' || step === 'waiting-for-host') && (
              <button
                onClick={() => {
                  multiplayerDisconnect();
                  useUIStore.getState().setGameCreated(false);
                  useUIStore.getState().setShowGameSetup(false);
                }}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            )}
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
                  onClick={() => {
                    // In multiplayer, both players already exist — dispatch roles now so player 2 can proceed
                    if (isMultiplayer && attackerPlayerIndex !== null) {
                      const currentState = useGameStore.getState().gameState;
                      const playerIds = Object.keys(currentState.players);
                      if (playerIds.length >= 2) {
                        const attackerId = playerIds[attackerPlayerIndex];
                        const defenderId = playerIds[attackerPlayerIndex === 0 ? 1 : 0];
                        dispatch({ type: 'DETERMINE_ATTACKER_DEFENDER', payload: { attackerId, defenderId } });
                        if (selectedMission) {
                          dispatch({ type: 'SET_MISSION', payload: { mission: selectedMission } });
                        }
                      }
                    }
                    setStep('import-attacker');
                  }}
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
            {step === 'detachment-attacker' && (
              <>
                <button
                  onClick={() => {
                    setSelectedDetachmentId(null);
                    setStep('import-defender');
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleDetachmentContinue}
                  disabled={!selectedDetachmentId}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
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
            {step === 'detachment-defender' && (
              <>
                <button
                  onClick={() => {
                    setSelectedDetachmentId(null);
                    setStep('done');
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={handleDetachmentContinue}
                  disabled={!selectedDetachmentId}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
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

      {/* Detachment hover tooltip */}
      {hoveredDetachment && (
        <PositionedDetachmentTooltip
          detachment={hoveredDetachment}
          showFactionRule
          x={hoverPos.x}
          y={hoverPos.y}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        />
      )}
    </div>
  );
}
