import { useEffect, useId, useState } from 'react';
import type { AgentAdapter, Exclusions } from '../adapter';

type ListKey = 'apps' | 'domains' | 'titleKeywords';

const LISTS: { key: ListKey; title: string; help: string; placeholder: string; min: number }[] = [
  { key: 'apps', title: 'Apps', help: 'App keys (like password_manager) or bundle ids (like com.apple.Notes).', placeholder: 'com.example.App', min: 1 },
  { key: 'domains', title: 'Websites', help: 'A site also covers its subdomains.', placeholder: 'example.com', min: 1 },
  { key: 'titleKeywords', title: 'Window title words', help: 'Any window whose title contains one of these is skipped. Not case-sensitive.', placeholder: 'payroll', min: 2 },
];

function ListEditor({ title, help, placeholder, min, items, onChange }: { title: string; help: string; placeholder: string; min: number; items: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const add = () => {
    const v = draft.trim();
    if (v.length < min || items.includes(v)) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <fieldset className="list">
      <legend className="subhead">{title}</legend>
      <p className="muted small" id={`${id}-help`}>
        {help}
      </p>
      <ul role="list" className="chips">
        {items.map((it) => (
          <li key={it}>
            <span className="mono">{it}</span>
            <button type="button" className="link" aria-label={`Remove ${it}`} onClick={() => onChange(items.filter((x) => x !== it))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <label htmlFor={`${id}-add`} className="sr-only">
          Add to {title}
        </label>
        <input
          id={`${id}-add`}
          aria-describedby={`${id}-help`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="button" onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

export function ExclusionsScreen({ adapter }: { adapter: AgentAdapter }) {
  const [ex, setEx] = useState<Exclusions | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void adapter.getExclusions().then(setEx);
  }, [adapter]);

  if (!ex) return <p className="muted">Loading…</p>;
  const update = (key: ListKey, v: string[]) => {
    setEx({ ...ex, [key]: v });
    setSaved(null);
  };
  const save = async () => {
    setEx(await adapter.setExclusions(ex));
    setSaved('Saved. Applies to everything from now on.');
  };

  return (
    <section aria-labelledby="ex-h">
      <h2 id="ex-h" className="display">
        Exclusions
      </h2>
      <p className="lede">Excluded windows are skipped on this computer before anything is stored. Only the fact that something excluded was open is recorded, with no name or title.</p>
      <p className="always">
        <span className="mono">Always on</span> Private and incognito browser windows are never observed.
      </p>
      {LISTS.map((l) => (
        <ListEditor
          key={l.key}
          title={l.title}
          help={l.help}
          placeholder={l.placeholder}
          min={l.min}
          items={ex[l.key]}
          onChange={(v) => update(l.key, v)}
        />
      ))}
      <div className="row">
        <button type="button" className="button" onClick={() => void save()}>
          Save exclusions
        </button>
        <span role="status" className="muted">
          {saved}
        </span>
      </div>
    </section>
  );
}
