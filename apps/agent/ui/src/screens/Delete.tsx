import { useState } from 'react';
import type { AgentAdapter } from '../adapter';

export function DeleteScreen({ adapter, onDeleted }: { adapter: AgentAdapter; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const ready = confirm.trim().toLowerCase() === 'delete';

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    await adapter.deleteEverything();
    setDone(true);
    onDeleted();
  };

  return (
    <section aria-labelledby="del-h">
      <h2 id="del-h" className="display">
        Delete everything on this computer
      </h2>
      <p className="lede">
        Removes every stored event, including ones not yet uploaded, the upload queue and local settings. Observing stops. This cannot be undone.
      </p>
      <p className="muted">
        It does not touch data already uploaded. To delete that too, use Privacy on the Tracer website, which deletes your account data and gives you a receipt.
      </p>
      {done ? (
        <p role="status" className="lede">
          Deleted. Nothing from Tracer remains in local storage.
        </p>
      ) : (
        <form className="form" onSubmit={(e) => void run(e)}>
          <label htmlFor="confirm">
            Type <span className="mono">delete</span> to confirm
          </label>
          <input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          <button type="submit" className="button danger" disabled={!ready}>
            Delete local data
          </button>
        </form>
      )}
    </section>
  );
}
