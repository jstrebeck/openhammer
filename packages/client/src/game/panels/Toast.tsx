import { useEffect, useState } from 'react';
import { useGameStore } from '../../storeContext';

export function Toast() {
  return (
    <>
      <RejectionToast />
      <UndoToast />
    </>
  );
}

/** Transient toast for server rejections. */
function RejectionToast() {
  const lastRejection = useGameStore((s) => s.lastRejection);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastRejection) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(timer);
  }, [lastRejection]);

  if (!visible || !lastRejection) return null;
  return (
    <div className="toast" role="alert">
      <strong>{lastRejection.code}</strong> {lastRejection.error}
    </div>
  );
}

/** Transient toast for the outcome of an undo request. */
function UndoToast() {
  const undoResult = useGameStore((s) => s.undoResult);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!undoResult) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(timer);
  }, [undoResult]);

  if (!visible || !undoResult) return null;
  const message = undoResult.performed
    ? 'Undo performed.'
    : undoResult.approved === false
      ? 'Undo request denied.'
      : 'Undo was not performed.';
  return (
    <div className={`toast ${undoResult.performed ? 'info' : ''}`} role="status">
      {message}
    </div>
  );
}
