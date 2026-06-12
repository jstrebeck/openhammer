import { useState } from 'react';
import { useMultiplayerStore, useMultiplayer } from '../networking/useMultiplayer';

export function RoomInfo() {
  const roomId = useMultiplayerStore((s) => s.roomId);
  const role = useMultiplayerStore((s) => s.role);
  const connected = useMultiplayerStore((s) => s.connected);
  const { disconnect } = useMultiplayer();
  const [copied, setCopied] = useState(false);

  if (!roomId) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-3 border-b border-gray-700 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>

      <div>
        <div className="text-[10px] text-gray-500 uppercase">Room Code</div>
        <button
          onClick={handleCopy}
          className="text-xl font-mono font-bold text-white tracking-widest hover:text-blue-400 transition-colors"
          title="Click to copy"
        >
          {roomId}
        </button>
        {copied && <div className="text-[10px] text-green-400">Copied!</div>}
      </div>

      <div className="text-xs text-gray-400">Role: {role}</div>

      <button
        onClick={disconnect}
        className="w-full py-1 px-2 bg-red-800/60 hover:bg-red-700 text-red-200 rounded text-xs transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}
