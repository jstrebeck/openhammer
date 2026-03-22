import { useState, useRef, useEffect } from 'react';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { useMultiplayer } from '../networking/useMultiplayer';

export function ChatPanel() {
  const roomId = useMultiplayerStore((s) => s.roomId);
  const messages = useMultiplayerStore((s) => s.chatMessages);
  const { sendChat } = useMultiplayer();
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Only show if in a multiplayer room
  if (!roomId) return null;

  const handleSend = () => {
    if (!text.trim()) return;
    sendChat(text.trim());
    setText('');
  };

  return (
    <div className="absolute bottom-16 right-[272px] w-64">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 transition-colors text-left"
      >
        Chat ({messages.length}) {expanded ? '▾' : '▸'}
      </button>

      {expanded && (
        <div className="mt-1 bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 shadow-lg flex flex-col" style={{ height: 240 }}>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {messages.length === 0 && (
              <div className="text-xs text-gray-500">No messages yet.</div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className="text-xs">
                <span className={msg.playerName === 'System' ? 'text-gray-500 italic' : 'text-blue-400 font-medium'}>
                  {msg.playerName}:
                </span>{' '}
                <span className="text-gray-300">{msg.text}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-gray-700 p-2 flex gap-1">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs border border-gray-600 focus:outline-none focus:border-blue-500"
              placeholder="Type a message..."
            />
            <button
              onClick={handleSend}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
