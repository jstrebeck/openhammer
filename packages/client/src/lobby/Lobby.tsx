import { useState } from 'react';
import { useGameStore } from '../storeContext';

export function Lobby() {
  const status = useGameStore((s) => s.status);
  const roomId = useGameStore((s) => s.roomId);
  const seat = useGameStore((s) => s.playerIndex);
  const game = useGameStore((s) => s.game);
  const presence = useGameStore((s) => s.presence);
  const importIssues = useGameStore((s) => s.importIssues);
  const importedUnitCount = useGameStore((s) => s.importedUnitCount);
  const serverError = useGameStore((s) => s.serverError);
  const createRoom = useGameStore((s) => s.createRoom);
  const joinRoom = useGameStore((s) => s.joinRoom);
  const spectate = useGameStore((s) => s.spectate);
  const uploadRoster = useGameStore((s) => s.uploadRoster);

  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const seated = roomId !== null && seat !== null;
  const rostersLoaded = game?.setup?.rostersLoaded ?? [false, false];
  const myRosterLoaded = seat !== null && rostersLoaded[seat];
  const oppRosterLoaded = seat !== null && rostersLoaded[seat === 0 ? 1 : 0];
  const opponentSeated = (presence?.seats.length ?? 0) > 1 || game?.players[1]?.name !== 'Awaiting opponent';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    try {
      const text = await file.text();
      uploadRoster(JSON.parse(text));
    } catch (e) {
      setFileError(`Could not parse roster file: ${(e as Error).message}`);
    }
  };

  return (
    <div className="lobby">
      <h1>OpenHammer</h1>
      <p className="muted">Status: {status}</p>
      {serverError && <p className="error">{serverError}</p>}

      {!seated ? (
        <div className="lobby-forms">
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Commander" />
          </label>
          <div className="lobby-row">
            <button disabled={!name.trim()} onClick={() => createRoom(name.trim())}>
              Create Game
            </button>
          </div>
          <div className="lobby-row">
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="Room ID"
            />
            <button
              disabled={!name.trim() || !joinId.trim()}
              onClick={() => joinRoom(joinId.trim(), name.trim())}
            >
              Join
            </button>
            <button
              disabled={!name.trim() || !joinId.trim()}
              onClick={() => spectate(joinId.trim(), name.trim())}
            >
              Spectate
            </button>
          </div>
        </div>
      ) : (
        <div className="lobby-seated">
          <p>
            Room <code className="room-code">{roomId}</code> — share this ID with your opponent.
          </p>
          <p>
            You are <strong>Player {seat + 1}</strong>.
            {!opponentSeated && ' Waiting for an opponent to join…'}
          </p>

          <h3>Upload your roster</h3>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {fileError && <p className="error">{fileError}</p>}
          {myRosterLoaded && (
            <p className="ok">
              Roster loaded{importedUnitCount !== null ? ` — ${importedUnitCount} unit(s)` : ''}.
            </p>
          )}
          {importIssues.length > 0 && (
            <div className="import-issues">
              <h4>Import issues</h4>
              <ul>
                {importIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {myRosterLoaded && !oppRosterLoaded && (
            <p className="muted">Waiting for your opponent's roster…</p>
          )}
        </div>
      )}
    </div>
  );
}
