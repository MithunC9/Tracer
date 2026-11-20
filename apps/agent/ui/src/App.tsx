import { useCallback, useEffect, useState } from 'react';
import type { AgentAdapter, AgentStatus } from './adapter';
import { SELF_OBSERVATION_LINE } from './format';
import { StatusScreen } from './screens/Status';
import { TodayScreen } from './screens/Today';
import { ExclusionsScreen } from './screens/Exclusions';
import { PairScreen } from './screens/Pair';
import { DeleteScreen } from './screens/Delete';

const SCREENS = [
  { id: 'status', label: 'Status' },
  { id: 'today', label: 'What left today' },
  { id: 'exclusions', label: 'Exclusions' },
  { id: 'pair', label: 'Pair' },
  { id: 'delete', label: 'Delete' },
] as const;
type ScreenId = (typeof SCREENS)[number]['id'];

export function App({ adapter }: { adapter: AgentAdapter }) {
  const [screen, setScreen] = useState<ScreenId>('status');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await adapter.status());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (status && !status.paired && screen === 'status') setScreen('pair');
  }, [status, screen]);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">Tracer</h1>
        <nav aria-label="Sections">
          <ul className="tabs" role="list">
            {SCREENS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="tab"
                  aria-current={screen === s.id ? 'page' : undefined}
                  onClick={() => setScreen(s.id)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <hr className="rule" />
      {adapter.kind === 'mock' && <p className="note mono">Preview with sample data. Nothing here is real.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <main>
        {screen === 'status' && <StatusScreen adapter={adapter} status={status} onChange={setStatus} />}
        {screen === 'today' && <TodayScreen adapter={adapter} />}
        {screen === 'exclusions' && <ExclusionsScreen adapter={adapter} />}
        {screen === 'pair' && <PairScreen adapter={adapter} status={status} onPaired={() => void refresh().then(() => setScreen('status'))} />}
        {screen === 'delete' && <DeleteScreen adapter={adapter} onDeleted={() => void refresh()} />}
      </main>
      <hr className="rule" />
      <footer className="footer">{SELF_OBSERVATION_LINE}</footer>
    </div>
  );
}
