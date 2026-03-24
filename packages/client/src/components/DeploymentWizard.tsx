import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { unitHasAbility, getUnitAbilityValue } from '@openhammer/core';
import type { SetupPhase } from '@openhammer/core';

/**
 * Sprint H: Deployment wizard — docked panel (non-blocking).
 * Handles alternating deployment, infiltrators, and scout moves.
 * Roll-off is handled by GameSetupDialog before this opens.
 */
export function DeploymentWizard({ onClose }: { onClose: () => void }) {
  const gameState = useGameStore((s) => s.gameState);
  const dispatch = useGameStore((s) => s.dispatch);

  const setSelectedModelIds = useUIStore((s) => s.setSelectedModelIds);

  const [wizardStep, setWizardStep] = useState<
    'deploying' | 'infiltrators' | 'scouts' | 'done'
  >('deploying');
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);

  const attackerId = gameState.attackerId;
  const defenderId = gameState.defenderId;

  // Deployment state
  const deploymentState = gameState.deploymentState;
  const currentDeployer = deploymentState.currentDeployingPlayerId;
  const currentDeployerName = gameState.players[currentDeployer]?.name ?? 'Player';
  const currentDeployerColor = gameState.players[currentDeployer]?.color;

  // Get units remaining for current deployer
  const unitsRemaining = deploymentState.unitsRemaining[currentDeployer] ?? [];
  const allUnitsRemaining = Object.values(deploymentState.unitsRemaining).flat();
  const infiltratorUnits = deploymentState.infiltratorUnits;

  // Scout units (exclude already-completed)
  const scoutMovesCompleted = deploymentState.scoutMovesCompleted;
  const scoutUnits = Object.values(gameState.units).filter(u =>
    unitHasAbility(u, 'SCOUT') && !scoutMovesCompleted.includes(u.id),
  );

  // Helper to advance setup phase
  const advanceToPhase = (target: SetupPhase) => {
    const phases: SetupPhase[] = ['muster', 'createBattlefield', 'determineRoles', 'placeObjectives', 'deploy', 'redeployments', 'determineFirstTurn', 'scoutMoves', 'ready'];
    const currentIdx = phases.indexOf(useGameStore.getState().gameState.setupPhase);
    const targetIdx = phases.indexOf(target);
    for (let i = currentIdx; i < targetIdx; i++) {
      dispatch({ type: 'ADVANCE_SETUP_PHASE' });
    }
  };

  // ─── Select unit for dragging ───
  const handleSelectUnit = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;
    const activeModelIds = unit.modelIds.filter(id =>
      gameState.models[id]?.status === 'active',
    );
    setSelectedModelIds(activeModelIds);
    setActiveUnitId(unitId);
  };

  // ─── Alternating deployment ───
  const handleDeployUnit = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;

    // Use current model positions (user has dragged them into position on the board)
    const positions: Record<string, { x: number; y: number }> = {};
    for (const modelId of unit.modelIds) {
      const model = gameState.models[modelId];
      if (model && model.status === 'active') {
        positions[modelId] = model.position;
      }
    }

    dispatch({ type: 'DEPLOY_UNIT', payload: { unitId, positions } });
    setActiveUnitId(null);
    setSelectedModelIds([]);
  };

  const handleFinishDeployment = () => {
    if (infiltratorUnits.length > 0) {
      setWizardStep('infiltrators');
    } else if (scoutUnits.length > 0) {
      setWizardStep('scouts');
    } else {
      setWizardStep('done');
    }
  };

  // ─── Infiltrators ───
  const handleDeployInfiltrator = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const modelId of unit.modelIds) {
      const model = gameState.models[modelId];
      if (model && model.status === 'active') {
        positions[modelId] = model.position;
      }
    }
    dispatch({ type: 'DEPLOY_INFILTRATORS', payload: { unitId, positions } });
    setActiveUnitId(null);
    setSelectedModelIds([]);
  };

  const handleFinishInfiltrators = () => {
    if (scoutUnits.length > 0) {
      setWizardStep('scouts');
    } else {
      setWizardStep('done');
    }
  };

  // ─── Scout moves ───
  const handleScoutMove = (unitId: string) => {
    const unit = gameState.units[unitId];
    if (!unit) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const modelId of unit.modelIds) {
      const model = gameState.models[modelId];
      if (model && model.status === 'active') {
        positions[modelId] = model.position;
      }
    }
    dispatch({ type: 'SCOUT_MOVE', payload: { unitId, positions } });
    setActiveUnitId(null);
    setSelectedModelIds([]);
  };

  // ─── Skip to next step ───
  const handleSkipStep = () => {
    if (wizardStep === 'deploying') {
      handleFinishDeployment();
    } else if (wizardStep === 'infiltrators') {
      handleFinishInfiltrators();
    } else if (wizardStep === 'scouts') {
      setWizardStep('done');
    }
  };

  // ─── First turn & start game ───
  const handleStartGame = () => {
    if (!attackerId) return;
    advanceToPhase('determineFirstTurn');
    dispatch({ type: 'DETERMINE_FIRST_TURN', payload: { playerId: attackerId } });
    advanceToPhase('ready');
  };

  return (
    <div className="absolute top-1/2 -translate-y-1/2 right-[22rem] z-40 w-[300px] max-h-[60vh] bg-gray-800/95 backdrop-blur rounded-lg shadow-xl border border-gray-600 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-sm font-medium text-white">
          {wizardStep === 'deploying' && 'Alternating Deployment'}
          {wizardStep === 'infiltrators' && 'Deploy Infiltrators'}
          {wizardStep === 'scouts' && 'Scout Moves'}
          {wizardStep === 'done' && 'Deployment Complete'}
        </h2>
        <div className="flex gap-1.5 mt-1.5">
          {['deploying', 'infiltrators', 'scouts', 'done'].map((s, i) => (
            <div key={s} className={`h-1 rounded-full flex-1 transition-colors ${
              ['deploying', 'infiltrators', 'scouts', 'done'].indexOf(wizardStep) >= i ? 'bg-blue-500' : 'bg-gray-600'
            }`} />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 flex-1 overflow-y-auto space-y-2">
        {/* Alternating Deployment */}
        {wizardStep === 'deploying' && (
          <>
            <div className="text-xs text-gray-300">
              <span className="font-medium text-white" style={currentDeployerColor ? { color: currentDeployerColor } : undefined}>
                {currentDeployerName}
              </span>'s turn to deploy. Drag the unit into your deployment zone, then click Deploy.
            </div>

            <div className="space-y-1 max-h-40 overflow-y-auto">
              {unitsRemaining.map((uid) => {
                const unit = gameState.units[uid];
                if (!unit) return null;
                const modelCount = unit.modelIds.filter(id =>
                  gameState.models[id]?.status === 'active',
                ).length;
                const isActive = activeUnitId === uid;
                return (
                  <div
                    key={uid}
                    onClick={() => handleSelectUnit(uid)}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-600/30 ring-1 ring-blue-500'
                        : 'bg-gray-700/40 hover:bg-gray-700/70'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white">{unit.name}</div>
                      <div className="text-[10px] text-gray-500">{modelCount} model{modelCount !== 1 ? 's' : ''}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeployUnit(uid); }}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white"
                    >
                      Deploy
                    </button>
                  </div>
                );
              })}
            </div>

            {allUnitsRemaining.length === 0 && (
              <div className="text-xs text-green-400">All regular units deployed.</div>
            )}
          </>
        )}

        {/* Infiltrators */}
        {wizardStep === 'infiltrators' && (
          <>
            <div className="text-xs text-gray-300">
              Deploy Infiltrators — must be &gt;9&quot; from enemy deployment zones and models.
            </div>
            <div className="space-y-1">
              {infiltratorUnits.map((uid) => {
                const unit = gameState.units[uid];
                if (!unit) return null;
                const isActive = activeUnitId === uid;
                return (
                  <div
                    key={uid}
                    onClick={() => handleSelectUnit(uid)}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-purple-600/30 ring-1 ring-purple-500'
                        : 'bg-gray-700/40 hover:bg-gray-700/70'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white">{unit.name}</div>
                      <div className="text-[10px] text-purple-400">INFILTRATORS</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeployInfiltrator(uid); }}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      Deploy
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Scout Moves */}
        {wizardStep === 'scouts' && (
          <>
            <div className="text-xs text-gray-300">
              Execute Scout moves — drag units on the board, then confirm each.
            </div>
            <div className="space-y-1">
              {scoutUnits.map((unit) => {
                const scoutDist = getUnitAbilityValue(unit, 'SCOUT') ?? 0;
                const isActive = activeUnitId === unit.id;
                return (
                  <div
                    key={unit.id}
                    onClick={() => handleSelectUnit(unit.id)}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-600/30 ring-1 ring-blue-500'
                        : 'bg-gray-700/40 hover:bg-gray-700/70'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white">{unit.name}</div>
                      <div className="text-[10px] text-gray-500">Scout {scoutDist}"</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleScoutMove(unit.id); }}
                      className="px-2 py-1 rounded text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Confirm Move
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Done */}
        {wizardStep === 'done' && (
          <div className="bg-green-900/30 border border-green-700 rounded p-3 text-center">
            <div className="text-xs text-green-300 font-medium">Deployment Complete!</div>
            <div className="text-[10px] text-green-400 mt-1">All units have been placed on the board.</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center p-3 border-t border-gray-700">
        {wizardStep === 'done' ? (
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-gray-400 hover:text-white text-xs"
          >
            Close
          </button>
        ) : (
          <button
            onClick={handleSkipStep}
            className="px-3 py-1.5 text-gray-400 hover:text-white text-xs"
          >
            Skip
          </button>
        )}
        <div>
          {wizardStep === 'deploying' && allUnitsRemaining.length === 0 && (
            <button onClick={handleFinishDeployment} className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs">
              Next
            </button>
          )}
          {wizardStep === 'infiltrators' && (
            <button onClick={handleFinishInfiltrators} className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs">
              Next
            </button>
          )}
          {wizardStep === 'scouts' && (
            <button onClick={() => { handleStartGame(); onClose(); }} className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs">
              Start Game
            </button>
          )}
          {wizardStep === 'done' && (
            <button onClick={() => { handleStartGame(); onClose(); }} className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-xs">
              Start Game
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
