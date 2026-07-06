import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../storeContext';

export function LogPanel() {
  const game = useGameStore((s) => s.game);
  const chat = useGameStore((s) => s.chat);
  const sendChat = useGameStore((s) => s.sendChat);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const logLength = game?.log.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLength, chat.length]);

  const submit = () => {
    sendChat(draft);
    setDraft('');
  };

  return (
    <section className="panel log-panel">
      <h2>Log</h2>
      <div className="log-scroll" ref={scrollRef}>
        {(game?.log ?? []).slice(-150).map((entry) => (
          <div key={entry.seq} className={`log-entry kind-${entry.kind}`}>
            <span className="muted">R{entry.round}</span> {entry.message}
          </div>
        ))}
        {chat.map((c, i) => (
          <div key={`chat-${i}`} className="log-entry chat">
            <strong>{c.from}:</strong> {c.text}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          placeholder="Chat…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button onClick={submit}>Send</button>
      </div>
    </section>
  );
}
