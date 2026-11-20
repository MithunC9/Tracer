import { useState } from 'react';
import type { AgentAdapter, AgentStatus } from '../adapter';
import { dayLine, modeLabel, relative } from '../format';

export function StatusScreen({ adapter, status, onChange }: { adapter: AgentAdapter; status: AgentStatus | null; onChange: (s: AgentStatus) => void }) {
  const [busy, setBusy] = useState(false);
  if (!status) return <p className="muted">Loading…</p>;

  const toggle = async () => {
    setBusy(true);
    try {
      onChange(status.mode === 'paused' ? await adapter.resume() : await adapter.pause());
    } finally {
      setBusy(false);
    }
  };
  const day = dayLine(status);
  const canToggle = status.mode === 'capturing' || status.mode === 'paused';

  return (
    <section aria-labelledby="status-h">
      <h2 id="status-h" className="display">
        {day ?? 'Status'}
      </h2>
      <p className="lede">
        {status.mode === 'capturing' && <span className="dot" aria-hidden="true" />}
        {modeLabel(status)}
      </p>
      {status.captureUntil && status.mode !== 'auto_stopped' && (
        <p className="muted">Stops by itself on {new Date(status.captureUntil).toLocaleString()}.</p>
      )}

      <dl className="figures">
        <div>
          <dt>Events today</dt>
          <dd className="mono">{status.eventsToday}</dd>
        </div>
        <div>
          <dt>Waiting to upload</dt>
          <dd className="mono">{status.pendingEvents}</dd>
        </div>
        <div>
          <dt>Last upload</dt>
          <dd className="mono">{relative(status.lastUploadAt)}</dd>
        </div>
        <div>
          <dt>Sent in total</dt>
          <dd className="mono">{status.eventsSentTotal}</dd>
        </div>
      </dl>
      {status.lastUploadError && <p className="muted">Last upload failed: {status.lastUploadError}. It will retry.</p>}
      {status.stopReason && status.mode !== 'capturing' && <p className="muted">Reason: {status.stopReason}.</p>}

      {canToggle && (
        <button type="button" className="button" onClick={() => void toggle()} disabled={busy}>
          {status.mode === 'paused' ? 'Resume observing' : 'Pause observing'}
        </button>
      )}
      <p className="muted small">
        Platform: <span className="mono">{status.platform}</span>
      </p>
    </section>
  );
}
