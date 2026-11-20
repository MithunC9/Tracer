import type { Metadata } from 'next';
import {
  FindingCard,
  FindingSection,
  Guides,
  Heading,
  Kicker,
  LedgerTable,
  Lede,
  MarginNote,
  PathTrail,
  RecipeSteps,
  Rule,
  ScoreBreakdown,
  Spread,
  StatFigure,
  Stagger,
  StaggerItem,
  ThemeToggle,
  ToolOptions,
  WeekStrip,
  fmt,
  fmtDate,
  fmtInt,
  ledgerRowsFromReport,
  pad2,
  weekRowsFromReport,
} from '@tracer/ui';
import { sampleReport } from '@tracer/ui/fixtures';

export const metadata: Metadata = { title: 'Sample report' };

const r = sampleReport;
const w = r.window;

const ledgerRows = ledgerRowsFromReport(r, (f) => (
  <div className="ds-ledger-detail">
    <p>{f.score.outputs.why}</p>
    <PathTrail steps={f.path} />
    <p className="ds-ledger-detail__meta tr-num">
      {f.metrics.occurrences}× on {f.metrics.daysSeen} of {w.daysObserved} days · avg {f.metrics.avgMinutes} min ·{' '}
      <a className="tr-link" href={`#${f.id}`}>
        Finding {pad2(f.rank)}
      </a>
    </p>
  </div>
));

export default function SampleReportPage() {
  return (
    <div className="tr-page rp" id="main">
      <Guides />
      <header className="rp-bar">
        <div className="rp-bar__left">
          <span className="rp-bar__mark">Tracer</span>
          <span className="tr-kicker">Efficiency audit · sample</span>
        </div>
        <ThemeToggle />
      </header>

      <Stagger className="rp-hero">
        <StaggerItem className="rp-hero__meta">
          <Kicker>
            {fmtDate(w.startsAt)} – {fmtDate(new Date(Date.parse(w.endsAt) - 1).toISOString())}
          </Kicker>
          <Kicker>{w.daysObserved} days observed</Kicker>
          <Kicker>{r.findings.length} findings</Kicker>
        </StaggerItem>
        <StaggerItem className="rp-hero__headline">
          <Heading level={1} size="display1">
            {r.summary.narrative.headline}
          </Heading>
        </StaggerItem>
        <StaggerItem className="rp-hero__figure">
          <StatFigure
            value={r.summary.reclaimableHoursPerWeek}
            unit="h / week"
            label="Reclaimable time"
            underline
            caption={r.summary.narrative.body}
            calculation={r.summary.calculation}
          />
        </StaggerItem>
        <StaggerItem className="rp-hero__notes">
          <MarginNote label="How to read this">
            Findings are ranked by time you could get back, not by how often they happened. Each number links to how it was computed.
          </MarginNote>
          <MarginNote label="Not counted">
            <span className="tr-num">{w.pausedMinutes}</span> paused minutes, <span className="tr-num">{w.excludedApps}</span> excluded apps and <span className="tr-num">{w.excludedDomains}</span>{' '}
            excluded sites.
          </MarginNote>
        </StaggerItem>
      </Stagger>

      <dl className="rp-window">
        <div>
          <dt>Active time</dt>
          <dd className="tr-num">{fmt(w.activeHoursObserved, 1)} h</dd>
        </div>
        <div>
          <dt>Events read</dt>
          <dd className="tr-num">{fmtInt(w.eventsAnalyzed)}</dd>
        </div>
        <div>
          <dt>Redactions</dt>
          <dd className="tr-num">{fmtInt(w.redactionsApplied)}</dd>
        </div>
        <div>
          <dt>Paused</dt>
          <dd className="tr-num">{w.pausedMinutes} min</dd>
        </div>
        <div>
          <dt>Numbers checked</dt>
          <dd className="tr-num">{r.generation.validator.checkedNumbers}</dd>
        </div>
      </dl>

      <section className="rp-block" aria-labelledby="ledger-h">
        <Spread
          wide
          notes={
            <MarginNote marker={1} label="Ranking">
              Reclaimable hours = hours per week × automatable share × <span className="tr-num">0.7</span>. The haircut covers review and exceptions.
            </MarginNote>
          }
        >
          <div className="rp-block__head">
            <Kicker>The ledger</Kicker>
            <Heading level={2} size="display3" id="ledger-h">
              What repeated, and what it cost
            </Heading>
          </div>
          <LedgerTable rows={ledgerRows} caption="Repeated workflows, ranked by reclaimable time" highlightId={r.summary.topFindingId} sortable />
        </Spread>
      </section>

      <section className="rp-block" aria-labelledby="week-h">
        <div className="rp-block__head">
          <Kicker>The week</Kicker>
          <Heading level={2} size="display3" id="week-h">
            When it happened
          </Heading>
        </div>
        <WeekStrip rows={weekRowsFromReport(r)} startsAt={w.startsAt} days={w.daysPlanned} caption="Each tick is one occurrence, placed at its time of day." />
      </section>

      <section className="rp-block" aria-labelledby="contents-h">
        <Spread>
          <div className="rp-block__head">
            <Kicker>Contents</Kicker>
            <Heading level={2} size="display3" id="contents-h">
              Findings
            </Heading>
          </div>
          {r.findings.map((f, i) => (
            <FindingCard key={f.id} finding={f} index={i + 1} top={f.id === r.summary.topFindingId} href={`#${f.id}`} />
          ))}
        </Spread>
      </section>

      <div className="rp-findings">
        {r.findings.map((f, i) => (
          <FindingSection
            key={f.id}
            finding={f}
            index={i + 1}
            daysObserved={w.daysObserved}
            top={f.id === r.summary.topFindingId}
            notes={
              <>
                <MarginNote label="Counted">
                  <span className="tr-num">{f.metrics.occurrences}</span> occurrences over <span className="tr-num">{f.metrics.daysSeen}</span> days, <span className="tr-num">{fmt(f.metrics.totalMinutes, 0)}</span> minutes in total.
                </MarginNote>
                <MarginNote label="Confidence">
                  {f.score.outputs.confidenceLabel === 'high'
                    ? 'Seen often and done the same way each time.'
                    : f.score.outputs.confidenceLabel === 'medium'
                      ? 'Seen a few times. Check it matches what you remember.'
                      : 'Seen rarely. Treat as a hint.'}
                </MarginNote>
              </>
            }
          >
            <div className="rp-sub">
              <Rule label="Evidence" />
              <WeekStrip rows={[{ id: f.id, label: f.label, occurrences: f.evidence, highlight: f.id === r.summary.topFindingId }]} startsAt={w.startsAt} days={w.daysPlanned} caption="Every occurrence this week." />
            </div>
            <div className="rp-sub">
              <Rule label="Score" />
              <ScoreBreakdown breakdown={f.score} />
            </div>
            <Spread>
              <div className="rp-sub">
                <Rule label="The fix" />
                <RecipeSteps recipe={f.recipe} id={`recipe-${f.id}`} />
              </div>
            </Spread>
            <div className="rp-sub">
              <Rule label="Ways to do it" />
              <ToolOptions tools={f.tools} diy={f.diyOption} recipeHref={`#recipe-${f.id}`} />
            </div>
          </FindingSection>
        ))}
      </div>

      <section className="rp-block" aria-labelledby="method-h">
        <Spread>
          <div className="rp-block__head">
            <Kicker>Method</Kicker>
            <Heading level={2} size="display3" id="method-h">
              How these numbers were made
            </Heading>
            <Lede>Every number in this report comes from code. The prose was checked: it may only repeat numbers the code produced.</Lede>
          </div>
          <dl className="rp-method">
            {r.methodology.map((m) => (
              <div key={m.title}>
                <dt>{m.title}</dt>
                <dd>{m.body}</dd>
              </div>
            ))}
          </dl>
          <div className="rp-block__head" style={{ marginTop: '3rem' }}>
            <Kicker>Limits</Kicker>
            <Heading level={3} size="title">
              What this audit could not see
            </Heading>
          </div>
          <ol className="rp-limits">
            {r.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </Spread>
      </section>

      <footer className="rp-colophon">
        <span className="tr-num">Audit {r.auditId.slice(0, 8)} · report v{r.reportVersion}</span>
        <span className="tr-num">
          Generated {fmtDate(r.generatedAt)} · narrator {r.generation.model} · validator {r.generation.validator.passed ? 'passed' : 'failed'}
        </span>
      </footer>
    </div>
  );
}
