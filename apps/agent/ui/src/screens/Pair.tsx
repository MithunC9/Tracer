import { useState } from 'react';
import type { AgentAdapter, AgentStatus } from '../adapter';
import { SELF_OBSERVATION_LINE } from '../format';

export function PairScreen({ adapter, status, onPaired }: { adapter: AgentAdapter; status: AgentStatus | null; onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('My Mac');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adapter.pair(code, name);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="pair-h">
      <h2 id="pair-h" className="display">
        Pair this computer
      </h2>
      {status?.paired && <p className="muted">This computer is already paired. Pairing again replaces the old link.</p>}
      <p className="lede">Start an audit on the Tracer website, then enter the 8-character code it shows you.</p>
      <p className="muted">{SELF_OBSERVATION_LINE}</p>
      <form onSubmit={(e) => void submit(e)} className="form">
        <label htmlFor="code">Pairing code</label>
        <input
          id="code"
          className="mono code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          spellCheck={false}
          maxLength={9}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'pair-error' : undefined}
        />
        <label htmlFor="device">Name for this computer</label>
        <input id="device" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        {error && (
          <p id="pair-error" className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </section>
  );
}
