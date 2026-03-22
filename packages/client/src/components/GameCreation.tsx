import { useState } from 'react';
import { listEditions, DEFAULT_EDITION_ID } from '@openhammer/core';
import { useGameStore } from '../store/gameStore';
import { useUIStore } from '../store/uiStore';
import { MultiplayerLobby } from './MultiplayerLobby';

export function GameCreation() {
  const [editionId, setEditionId] = useState(DEFAULT_EDITION_ID);
  const [boardWidth, setBoardWidth] = useState(60);
  const [boardHeight, setBoardHeight] = useState(44);
  const [tab, setTab] = useState<'local' | 'online'>('local');

  const editions = listEditions();

  const handleCreate = () => {
    useGameStore.getState().resetGame({ editionId, boardWidth, boardHeight });
    useUIStore.getState().setGameCreated(true);
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full">
        <h1 className="text-2xl font-bold text-white mb-6">OpenHammer</h1>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setTab('local')}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === 'local' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Local Game
          </button>
          <button
            onClick={() => setTab('online')}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === 'online' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Online
          </button>
        </div>

        {tab === 'local' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Edition</label>
              <select
                value={editionId}
                onChange={(e) => setEditionId(e.target.value)}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                {editions.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm text-gray-300 mb-1">Width (inches)</label>
                <input
                  type="number"
                  value={boardWidth}
                  onChange={(e) => setBoardWidth(Number(e.target.value))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
                  min={10}
                  max={120}
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-300 mb-1">Height (inches)</label>
                <input
                  type="number"
                  value={boardHeight}
                  onChange={(e) => setBoardHeight(Number(e.target.value))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
                  min={10}
                  max={120}
                />
              </div>
            </div>

            <button
              onClick={handleCreate}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors"
            >
              Create Local Game
            </button>
          </div>
        )}

        {tab === 'online' && <MultiplayerLobby />}
      </div>
    </div>
  );
}
