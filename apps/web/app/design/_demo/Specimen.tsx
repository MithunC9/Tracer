import type { ReactNode } from 'react';
import { Kicker, MarginNote, Spread } from '@tracer/ui';

/** A numbered section of the design page: title, short usage note in the margin, specimens. */
export function Section({ n, id, title, note, children }: { n: number; id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="ds-section" aria-labelledby={`${id}-h`}>
      <div className="ds-section__head">
        <Kicker number={String(n).padStart(2, '0')}>Section</Kicker>
        <h2 id={`${id}-h`} className="tr-heading" data-size="display3">
          {title}
        </h2>
      </div>
      <Spread notes={note ? <MarginNote label="Use">{note}</MarginNote> : undefined}>
        <div className="ds-specimens">{children}</div>
      </Spread>
    </section>
  );
}

/** One labelled specimen. `state` is printed mono beside the label. */
export function Specimen({ label, state, children, wide }: { label: string; state?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="ds-spec" data-wide={wide || undefined}>
      <p className="ds-spec__label">
        <span>{label}</span>
        {state ? <span className="ds-spec__state">{state}</span> : null}
      </p>
      <div className="ds-spec__body">{children}</div>
    </div>
  );
}

/** The same content on paper and on kraft, side by side. */
export function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="ds-pair">
      <div data-theme="light" className="ds-pair__panel">
        <p className="ds-pair__tag">Paper</p>
        {children}
      </div>
      <div data-theme="dark" className="ds-pair__panel">
        <p className="ds-pair__tag">Kraft</p>
        {children}
      </div>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="ds-row">{children}</div>;
}
