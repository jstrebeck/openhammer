import { useEffect, useState } from 'react';
import { useGameStore } from '../../storeContext';

/** Transient toast for server rejections. */
export function Toast() {
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
