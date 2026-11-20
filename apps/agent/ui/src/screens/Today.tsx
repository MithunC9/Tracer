import { useEffect, useState } from 'react';
import type { AgentAdapter, RedactionKind, TodayView } from '../adapter';
import { REDACTION_LABELS, describe, redactionTotal, time } from '../format';

export function TodayScreen({ adapter }: { adapter: AgentAdapter }) {
  const [view, setView] = useState<TodayView | null>(null);
  const [raw, setRaw] = useState<string | null>(null);

  useEffect(() => {
    void adapter.today().then(setView);
  }, [adapter]);

  if (!view) return <p className="muted">Loading…</p>;
  const kinds = Object.entries(view.redactions).filter(([, n]) => (n ?? 0) > 0) as [RedactionKind, number][];

  return (
    <section aria-labelledby="today-h">
      <h2 id="today-h" className="display">
        What left this device today
      </h2>
      <p className="lede">
        Every event recorded today, exactly as stored and uploaded. <span className="mono">{view.sent}</span> sent,{' '}
        <span className="mono">{view.pending}</span> waiting.
      </p>

      <h3 className="subhead">Removed before storing</h3>
      {kinds.length === 0 ? (
        <p className="muted">Nothing needed removing today.</p>
      ) : (
        <table className="ledger compact">
          <tbody>
            {kinds.map(([k, n]) => (
              <tr key={k}>
                <th scope="row">{REDACTION_LABELS[k]}</th>
                <td className="mono num">{n}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row">Total</th>
              <td className="mono num">{redactionTotal(view.redactions)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <h3 className="subhead">Events</h3>
      {view.events.length === 0 ? (
        <p className="muted">No events today.</p>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">What</th>
              <th scope="col">Exactly what was kept</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="sr-only">Raw</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.events.map(({ event, status }) => {
              const d = describe(event);
              return (
                <tr key={event.id}>
                  <td className="mono">{time(event.ts)}</td>
                  <td>{d.what}</td>
                  <td className="detail">{d.detail}</td>
                  <td className="mono">{status}</td>
                  <td>
                    <button type="button" className="link" onClick={() => setRaw(JSON.stringify(event, null, 2))}>
                      JSON
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {raw && (
        <div className="raw" role="region" aria-label="Raw event">
          <div className="raw-head">
            <span className="muted">The exact JSON for this event</span>
            <button type="button" className="link" onClick={() => setRaw(null)}>
              Close
            </button>
          </div>
          <pre className="mono">{raw}</pre>
        </div>
      )}
    </section>
  );
}
