import { useState } from 'react';
import { useMultiplayer, useMultiplayerStore } from '../networking/useMultiplayer';
import { useUIStore } from '../store/uiStore';

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const DEFAULT_SERVER = `${wsProtocol}//${window.location.host}/ws`;

export function MultiplayerLobby() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const { createRoom, joinRoom } = useMultiplayer();
  const connected = useMultiplayerStore((s) => s.connected);
  const roomId = useMultiplayerStore((s) => s.roomId);
  const role = useMultiplayerStore((s) => s.role);
  const error = useMultiplayerStore((s) => s.error);

  // If already in a room, show the room info instead
  if (roomId) {
    return <RoomInfo />;
  }

  const handleCreate = () => {
    if (!playerName.trim()) return;
    createRoom(serverUrl, playerName.trim());
    // gameCreated is set when ROOM_CREATED is received (see useMultiplayer)
  };

  const handleJoin = () => {
    if (!playerName.trim() || !joinCode.trim()) return;
    joinRoom(serverUrl, joinCode.trim().toUpperCase(), playerName.trim());
    // gameCreated is set when ROOM_JOINED is received (see useMultiplayer)
  };

  return (
    <div className="space-y-4">
      {mode === 'menu' && (
        <div className="space-y-2">
          <button
            onClick={() => setMode('create')}
            className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
          >
            Host Game
          </button>
          <button
            onClick={() => setMode('join')}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
          >
            Join Game
          </button>
        </div>
      )}

      {mode !== 'menu' && (
        <>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Your Name</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Enter your name"
              autoFocus
            />
          </div>

          {mode === 'join' && (
            <div>
              <label className="block text-sm text-gray-300 mb-1">Room Code</label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none font-mono tracking-widest text-center text-lg"
                placeholder="ABC123"
                maxLength={6}
              />
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Server</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none text-xs"
            />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded p-2">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setMode('menu')}
              className="flex-1 py-2 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition-colors"
            >
              Back
            </button>
            <button
              onClick={mode === 'create' ? handleCreate : handleJoin}
              disabled={!playerName.trim() || (mode === 'join' && !joinCode.trim())}
              className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mode === 'create' ? 'Create Room' : 'Join Room'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RoomInfo() {
  const roomId = useMultiplayerStore((s) => s.roomId);
  const role = useMultiplayerStore((s) => s.role);
  const connected = useMultiplayerStore((s) => s.connected);
  const { disconnect } = useMultiplayer();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
      <div>
        <div className="text-[10px] text-gray-500 uppercase">Room Code</div>
        <div className="text-xl font-mono font-bold text-white tracking-widest">{roomId}</div>
      </div>
      <div className="text-xs text-gray-400">Role: {role}</div>
      <button
        onClick={disconnect}
        className="w-full py-1.5 px-3 bg-red-800 hover:bg-red-700 text-white rounded text-xs transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}
