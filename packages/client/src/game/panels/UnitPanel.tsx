import { useGameStore } from '../../storeContext';
import { profileFor } from '../interaction';

export function UnitPanel() {
  const game = useGameStore((s) => s.game);
  const datasheets = useGameStore((s) => s.datasheets);
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const seat = useGameStore((s) => s.playerIndex);

  const unit = game && selectedUnitId ? game.units[selectedUnitId] : undefined;
  if (!game || !unit) {
    return (
      <section className="panel unit-panel">
        <h2>Unit</h2>
        <p className="muted">Click a model to inspect its unit.</p>
      </section>
    );
  }

  const datasheet = datasheets[unit.datasheetId];
  const profile = datasheet?.models[0];
  const alive = unit.models.filter((m) => !m.destroyed);
  const flags = unit.turnFlags;
  const flagText: string[] = [];
  if (flags.moveKind) flagText.push(`moved: ${flags.moveKind}`);
  if (flags.hasShot) flagText.push('has shot');
  if (flags.hasFought) flagText.push('has fought');
  if (unit.battleShocked) flagText.push('battle-shocked');
  if (unit.unmatched) flagText.push('unmatched import');

  return (
    <section className="panel unit-panel">
      <h2>
        {unit.name}{' '}
        <span className={`owner-tag p${unit.owner}`}>
          {unit.owner === seat ? 'yours' : game.players[unit.owner].name}
        </span>
      </h2>
      {profile ? (
        <table className="statline">
          <thead>
            <tr>
              <th>M</th>
              <th>T</th>
              <th>Sv</th>
              <th>W</th>
              <th>Ld</th>
              <th>OC</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{profile.move}"</td>
              <td>{profile.toughness}</td>
              <td>{profile.save}+</td>
              <td>{profile.wounds}</td>
              <td>{profile.leadership}+</td>
              <td>{profile.objectiveControl}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted">No datasheet found ({unit.datasheetId}).</p>
      )}
      <p>
        Models: {alive.length}/{unit.startingStrength}
        {flagText.length > 0 && <span className="muted"> — {flagText.join(', ')}</span>}
      </p>
      <ul className="model-list">
        {unit.models.map((m) => {
          const p = profileFor(datasheet, m);
          const max = p?.wounds ?? m.woundsRemaining;
          return (
            <li key={m.id} className={m.destroyed ? 'destroyed' : ''}>
              {m.destroyed ? '✝ ' : ''}
              {m.id.split('-').slice(-1)[0]} — {m.destroyed ? 'destroyed' : `${m.woundsRemaining}/${max} W`}
            </li>
          );
        })}
      </ul>
      {Object.keys(unit.weapons).length > 0 && (
        <>
          <h3>Weapons</h3>
          <table className="weapons">
            <thead>
              <tr>
                <th>Name</th>
                <th>R</th>
                <th>A</th>
                <th>Sk</th>
                <th>S</th>
                <th>AP</th>
                <th>D</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(unit.weapons).map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.range === null ? '—' : `${w.range}"`}</td>
                  <td>{w.attacks}</td>
                  <td>{w.skill === null ? 'N/A' : `${w.skill}+`}</td>
                  <td>{w.strength}</td>
                  <td>{w.ap}</td>
                  <td>{w.damage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
