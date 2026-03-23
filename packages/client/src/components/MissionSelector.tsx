import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { MISSIONS } from '@openhammer/core';
import type { Mission } from '@openhammer/core';

/**
 * Sprint I: Mission selection screen.
 * Pick mission, see deployment map preview, objective positions, scoring summary.
 */
export function MissionSelector({ onClose }: { onClose: () => void }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const gameState = useGameStore((s) => s.gameState);
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null);

  const handleApply = () => {
    if (!selectedMission) return;
    dispatch({ type: 'SET_MISSION', payload: { mission: selectedMission } });
    onClose();
  };

  const activeMission = gameState.mission;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-600 w-[700px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Select Mission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto">
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
                      : activeMission?.id === m.id
                        ? 'border-green-500/50 bg-green-900/20'
                        : 'border-gray-600 hover:border-gray-500 bg-gray-700/50'
                  }`}
                >
                  <div className="text-sm font-medium text-white">{m.name}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {m.battlefieldSize.width}" × {m.battlefieldSize.height}" | {m.maxBattleRounds} rounds | {m.objectivePlacements.length} objectives
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    First turn: {m.firstTurnRule === 'attacker_first' ? 'Attacker' : m.firstTurnRule === 'defender_first' ? 'Defender' : 'Roll-off'}
                  </div>
                  {activeMission?.id === m.id && (
                    <div className="text-[10px] text-green-400 mt-1">● Currently active</div>
                  )}
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
                      {/* Board background */}
                      <rect width={selectedMission.battlefieldSize.width} height={selectedMission.battlefieldSize.height}
                        fill="#1a1a2e" stroke="#333" strokeWidth="0.5" />

                      {/* Deployment zones */}
                      {selectedMission.deploymentMap.map((zone, i) => (
                        <polygon
                          key={i}
                          points={zone.polygon.map(p => `${p.x},${p.y}`).join(' ')}
                          fill={zone.role === 'attacker' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)'}
                          stroke={zone.role === 'attacker' ? '#3b82f6' : '#ef4444'}
                          strokeWidth="0.5"
                        />
                      ))}

                      {/* Objectives */}
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

                    {/* Deployment zone legend */}
                    <div className="flex gap-3 mt-2">
                      {selectedMission.deploymentMap.map((zone, i) => (
                        <div key={i} className="flex items-center gap-1 text-[10px]">
                          <span className={`w-2 h-2 rounded-sm ${zone.role === 'attacker' ? 'bg-blue-500' : 'bg-red-500'}`} />
                          <span className="text-gray-400">{zone.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Objectives list */}
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Objectives</div>
                    <div className="space-y-0.5">
                      {selectedMission.objectivePlacements.map((obj) => (
                        <div key={obj.number} className="text-[10px] text-gray-300 flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-yellow-600 flex items-center justify-center text-[8px] text-black font-bold">
                            {obj.number}
                          </span>
                          {obj.label ?? `Objective ${obj.number}`}
                          <span className="text-gray-500 ml-auto">
                            ({obj.position.x}", {obj.position.y}")
                          </span>
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
                          <div className="text-[10px] text-gray-400 mt-0.5">{sc.description}</div>
                          {sc.maxVp && (
                            <div className="text-[10px] text-gray-500">Max: {sc.maxVp} VP</div>
                          )}
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

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-sm">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedMission}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-40"
          >
            Apply Mission
          </button>
        </div>
      </div>
    </div>
  );
}
