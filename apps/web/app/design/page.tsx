import type { Metadata } from 'next';
import {
  AccessLogTable,
  Button,
  CalcSteps,
  Checkbox,
  color,
  ConfidenceMarks,
  CountdownBadge,
  DeletionReceipt,
  EmptyState,
  ErrorState,
  FindingCard,
  FindingSection,
  FootnoteRef,
  Footnotes,
  Heading,
  HoursBar,
  Kbd,
  Kicker,
  LedgerTable,
  Lede,
  MarginNote,
  Notice,
  PathTrail,
  Popover,
  PotentialTicks,
  PrivacyLedger,
  ProgressRule,
  RecipeSteps,
  Rule,
  RuledSkeleton,
  ScoreBreakdown,
  Select,
  StatFigure,
  Tabs,
  Tag,
  TextArea,
  TextField,
  TextLink,
  ThemeToggle,
  Toggle,
  ToolOptions,
  Tooltip,
  WeekStrip,
  ledgerRowsFromReport,
  motion,
  rule,
  space,
  type,
  weekRowsFromReport,
} from '@tracer/ui';
import { sampleAccessLog, sampleDeletionReceipt, samplePrivacy, sampleReport } from '@tracer/ui/fixtures';
import { AccessErrorDemo, DialogDemo, InlineConfirmDemo, InlineDialogDemo, ErrorDemo, LedgerErrorDemo, NoticeDemo, ToastDemo, ToggleDemo } from './_demo/Interactive';
import { Pair, Row, Section, Specimen } from './_demo/Specimen';

export const metadata: Metadata = { title: 'Design system' };

const report = sampleReport;
const top = report.findings[0]!;
const second = report.findings[1]!;
const last = report.findings[report.findings.length - 1]!;

const rows = ledgerRowsFromReport(report, (f) => (
  <div className="ds-ledger-detail">
    <p>{f.score.outputs.why}</p>
    <PathTrail steps={f.path} />
    <p className="ds-ledger-detail__meta tr-num">
      {f.metrics.occurrences}× on {f.metrics.daysSeen} of {report.window.daysObserved} days · avg {f.metrics.avgMinutes} min ·{' '}
      <a className="tr-link" href={`/design/report#${f.id}`}>
        Read finding {String(f.rank).padStart(2, '0')}
      </a>
    </p>
  </div>
));

const longRows = [
  ...rows.slice(0, 2),
  {
    ...rows[2]!,
    id: 'long',
    rank: 3,
    label: 'Download supplier invoices from three portals, rename them by date and supplier, and file them in the shared accounting folder',
  },
];

// 14-day variant: the same week twice, second week slightly thinner.
const twoWeeks = weekRowsFromReport(report)
  .slice(0, 3)
  .map((r) => ({
    ...r,
    occurrences: [
      ...r.occurrences,
      ...r.occurrences.filter((_, i) => i % 3 !== 1).map((o) => ({ ...o, episodeId: `${o.episodeId}_w2`, dayIndex: o.dayIndex + 7, start: shift(o.start, 7), end: shift(o.end, 7) })),
    ],
  }));
function shift(iso: string, days: number) {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

const swatches: Array<{ token: keyof typeof color.light; role: string }> = [
  { token: 'paper', role: 'Page' },
  { token: 'paperSunk', role: 'Header band, hover' },
  { token: 'paperRaised', role: 'Receipt, dialog, input' },
  { token: 'ink', role: 'Text, marks' },
  { token: 'graphite', role: 'Secondary text' },
  { token: 'rule', role: 'Hairlines only' },
  { token: 'signal', role: 'The one finding that matters' },
  { token: 'signalInk', role: 'Error text, destructive' },
];

const nav: Array<[string, string]> = [
  ['tokens', 'Tokens'],
  ['type', 'Type'],
  ['buttons', 'Buttons & links'],
  ['fields', 'Fields'],
  ['marks', 'Tags, rules, notes'],
  ['overlays', 'Tooltip, popover, dialog, tabs'],
  ['states', 'Loading, empty, error'],
  ['stat', 'Stat figure'],
  ['ledger', 'Ledger'],
  ['week', 'Week strip'],
  ['path', 'Path trail'],
  ['score', 'Score breakdown'],
  ['recipe', 'Recipe'],
  ['tools', 'Tool options'],
  ['finding', 'Findings'],
  ['capture', 'Capture'],
  ['privacy', 'Privacy'],
  ['dark', 'Paper and kraft'],
];

export default function DesignPage() {
  return (
    <div className="tr-page ds" id="main">
      <header className="ds-mast">
        <div className="ds-mast__bar">
          <p className="tr-kicker">Tracer · Design record · v0.1</p>
          <ThemeToggle />
        </div>
        <div className="ds-mast__title">
          <Heading level={1} size="display1">
            A lab record for <em>how work actually happens.</em>
          </Heading>
          <aside className="ds-mast__aside">
            <Lede>Paper, ink and one vermilion mark. Numbers are set in mono. Rules divide; boxes and shadows do not.</Lede>
            <p className="ds-mast__links">
              <a className="tr-link" href="/design/report">
                See the full report composition
              </a>
            </p>
          </aside>
        </div>
        <nav className="ds-index" aria-label="Sections">
          <ol>
            {nav.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <span className="tr-num">{String(i + 1).padStart(2, '0')}</span> {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <Section n={1} id="tokens" title="Tokens" note={<>One signal colour, used for one thing per view. Every pair in the table passes WCAG AA; see TOKENS.md. Dark mode is cream ink on kraft, not grey.</>}>
        <Specimen label="Colour" state="paper / kraft" wide>
          <table className="ds-swatches">
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col">Role</th>
                <th scope="col">Paper</th>
                <th scope="col">Kraft</th>
              </tr>
            </thead>
            <tbody>
              {swatches.map((s) => (
                <tr key={s.token}>
                  <th scope="row" className="tr-num">
                    {s.token}
                  </th>
                  <td>{s.role}</td>
                  <td>
                    <span className="ds-chip" style={{ background: color.light[s.token] }} />
                    <span className="tr-num">{color.light[s.token]}</span>
                  </td>
                  <td>
                    <span className="ds-chip" style={{ background: color.dark[s.token] }} />
                    <span className="tr-num">{color.dark[s.token]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Specimen>
        <Specimen label="Spacing" state="4px base">
          <div className="ds-space">
            {Object.entries(space)
              .filter(([k]) => !['0', 'px', '0.5'].includes(k))
              .map(([k, v]) => (
                <div key={k} className="ds-space__row">
                  <span className="tr-num">{k}</span>
                  <span className="ds-space__bar" style={{ width: v }} />
                  <span className="tr-num">{v}</span>
                </div>
              ))}
          </div>
        </Specimen>
        <Specimen label="Rules" state="hair · thin · heavy · double · hand">
          <div className="ds-rules">
            {(['hair', 'thin', 'heavy', 'double'] as const).map((w) => (
              <div key={w}>
                <span className="tr-num">
                  {w} {rule[w]}
                </span>
                <Rule weight={w} tone="ink" />
              </div>
            ))}
            <div>
              <span className="tr-num">hand-ruled</span>
              <Rule hand />
            </div>
            <div>
              <span className="tr-num">labelled</span>
              <Rule label="Methodology" />
            </div>
          </div>
        </Specimen>
        <Specimen label="Motion" state="sparse, purposeful">
          <table className="ds-kv">
            <tbody>
              {Object.entries(motion.duration).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className="tr-num">
                    {k}
                  </th>
                  <td className="tr-num">{v} ms</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="tr-num">
                  ease.out
                </th>
                <td className="tr-num">{motion.easing.out}</td>
              </tr>
            </tbody>
          </table>
        </Specimen>
      </Section>

      <Section n={2} id="type" title="Type" note={<>Instrument Serif for headlines only. Geist for interface. Geist Mono for every number, always tabular.</>}>
        <Specimen label="Scale" wide>
          <div className="ds-type">
            {(['display1', 'display2', 'display3', 'title'] as const).map((k) => (
              <div key={k} className="ds-type__row">
                <span className="tr-num ds-type__meta">
                  {k}
                  <br />
                  {type[k][0].startsWith('clamp') ? 'fluid' : type[k][0]}
                </span>
                <Heading level={3} size={k}>
                  Copying, matching, retyping
                </Heading>
              </div>
            ))}
            <div className="ds-type__row">
              <span className="tr-num ds-type__meta">lede</span>
              <Lede>You exported payouts from Stripe and reconciled them by hand on six of seven days.</Lede>
            </div>
            <div className="ds-type__row">
              <span className="tr-num ds-type__meta">body</span>
              <p>The steps barely changed. Fees and refunds were matched by eye each time. A sync tool can post payouts with fees split out.</p>
            </div>
            <div className="ds-type__row">
              <span className="tr-num ds-type__meta">small</span>
              <p className="ds-small">Weekly hours are total minutes divided by calendar weeks observed.</p>
            </div>
            <div className="ds-type__row">
              <span className="tr-num ds-type__meta">kicker</span>
              <Kicker number="01">Finding</Kicker>
            </div>
            <div className="ds-type__row">
              <span className="tr-num ds-type__meta">mono</span>
              <p className="tr-num ds-mono-sample">0123456789 · 3.7 h/wk · 18,442 events · wf_3a9c41e07b</p>
            </div>
          </div>
        </Specimen>
      </Section>

      <Section n={3} id="buttons" title="Buttons and links" note={<>Primary is ink. Vermilion only for destroying data. Focus ring: 2px ink, offset 3px; vermilion on destructive.</>}>
        {(['primary', 'secondary', 'quiet', 'destructive'] as const).map((v) => (
          <Specimen key={v} label={v} state="default · hover · focus · disabled · loading" wide>
            <Row>
              <Button variant={v}>{v === 'destructive' ? 'Delete everything' : v === 'quiet' ? 'Show calculation' : 'Start a 7-day audit'}</Button>
              <Button variant={v} forceState="hover">
                Hover
              </Button>
              <Button variant={v} forceState="focus">
                Focus
              </Button>
              <Button variant={v} disabled>
                Disabled
              </Button>
              <Button variant={v} loading loadingLabel="Saving">
                Saving
              </Button>
            </Row>
          </Specimen>
        ))}
        <Specimen label="Sizes and trailing glyph">
          <Row>
            <Button size="sm">Small</Button>
            <Button trailing="→">Read the report</Button>
            <Button size="lg" variant="secondary" trailing="→">
              Pair this Mac
            </Button>
          </Row>
        </Specimen>
        <Specimen label="Links" state="default · hover · focus · external · destructive">
          <Row>
            <TextLink href="#">Privacy center</TextLink>
            <TextLink href="#" forceState="hover">
              Hovered
            </TextLink>
            <TextLink href="#" forceState="focus">
              Focused
            </TextLink>
            <TextLink href="https://n8n.io" external>
              n8n docs
            </TextLink>
            <TextLink href="#" tone="quiet">
              Quiet
            </TextLink>
            <TextLink href="#" tone="destructive">
              Delete this audit
            </TextLink>
          </Row>
        </Specimen>
      </Section>

      <Section n={4} id="fields" title="Fields" note={<>Labels sit above, hints below, errors below the hint in text-safe vermilion with a thicker left edge. Never placeholder-as-label.</>}>
        <div className="ds-grid2">
          <Specimen label="Text field" state="default">
            <TextField label="Email" type="email" placeholder="you@example.com" hint="We send the report link here. Nothing else." />
          </Specimen>
          <Specimen label="Text field" state="hover">
            <TextField label="Audit name" defaultValue="November baseline" forceState="hover" />
          </Specimen>
          <Specimen label="Text field" state="focus">
            <TextField label="Pairing code" mono defaultValue="7KQ-2MD" forceState="focus" hint="Shown in the Tracer app on your Mac." />
          </Specimen>
          <Specimen label="Text field" state="error">
            <TextField label="Pairing code" mono defaultValue="7KQ-2M" error="That code is 6 characters. It expired or was mistyped." />
          </Specimen>
          <Specimen label="Text field" state="disabled">
            <TextField label="Audit length" defaultValue="7 days" disabled hint="Fixed once capture starts." />
          </Specimen>
          <Specimen label="Text field" state="optional, long label">
            <TextField label="Anything Tracer should ignore, such as a client name that appears in window titles" optional placeholder="Acme Holdings" />
          </Specimen>
          <Specimen label="Select" state="default · error · disabled">
            <div className="ds-stack">
              <Select
                label="Audit length"
                defaultValue="7"
                options={[
                  { value: '3', label: '3 days' },
                  { value: '7', label: '7 days (recommended)' },
                  { value: '14', label: '14 days' },
                ]}
              />
              <Select label="Platform" error="Pick the computer you will audit." options={[{ value: '', label: 'Choose…' }]} />
              <Select label="Budget" disabled options={[{ value: 'any', label: 'Any' }]} />
            </div>
          </Specimen>
          <Specimen label="Text area">
            <TextArea label="What should we know?" optional hint="Ruled like a notebook page." defaultValue={'Month-end close is not in this week.\nI work from a laptop on Fridays.'} />
          </Specimen>
          <Specimen label="Checkbox" state="unchecked · checked · focus · error · disabled">
            <div className="ds-stack">
              <Checkbox label="Exclude private browser windows" defaultChecked />
              <Checkbox label="Exclude Slack direct messages" hint="Channel names are still recorded." />
              <Checkbox label="Focused checkbox" forceState="focus" />
              <Checkbox label="I am auditing my own work, on my own computer" error="Tracer is only for observing your own work." />
              <Checkbox label="Capture keystrokes" disabled hint="Never available." />
            </div>
          </Specimen>
          <Specimen label="Toggle" state="off · on · disabled · live">
            <div className="ds-stack">
              <Toggle label="Weekly digest email" />
              <Toggle label="Monthly re-audit" defaultChecked hint="Runs the first week of each month." />
              <Toggle label="Upload over metered networks" disabled />
              <ToggleDemo />
            </div>
          </Specimen>
        </div>
      </Section>

      <Section n={5} id="marks" title="Tags, rules, notes" note={<>Tags are square and mono: not pills, never with icons. Margin notes carry method and caveats so the main column stays plain.</>}>
        <Specimen label="Tags" state="outline · plain · ink · signal">
          <Row>
            <Tag>Easy</Tag>
            <Tag tone="plain">Gmail</Tag>
            <Tag tone="ink">Top finding</Tag>
            <Tag tone="signal">Money</Tag>
            <Tag tone="signal">Personal data</Tag>
          </Row>
        </Specimen>
        <Specimen label="Kbd">
          <p>
            Move with <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>, open with <Kbd>Enter</Kbd>, close with <Kbd>Esc</Kbd>.
          </p>
        </Specimen>
        <Specimen label="Data glyphs" state="hours bar · automatable ticks · confidence">
          <div className="ds-glyphs">
            <span>
              <HoursBar value={3.7} max={3.7} signal /> <span className="tr-num">3.7</span>
            </span>
            <span>
              <HoursBar value={0.8} max={3.7} /> <span className="tr-num">0.8</span>
            </span>
            <span>
              <PotentialTicks value={71} /> <span className="tr-num">71</span>
            </span>
            <span>
              <PotentialTicks value={35} /> <span className="tr-num">35</span>
            </span>
            <ConfidenceMarks level="high" />
            <ConfidenceMarks level="medium" />
            <ConfidenceMarks level="low" />
          </div>
        </Specimen>
        <Specimen label="Margin note and footnotes" wide>
          <div className="ds-notes">
            <p className="ds-notes__text">
              Reclaimable hours apply a fixed haircut<FootnoteRef n={1} scope="ds" /> because automation never removes all of the time. Weekends count as days observed
              <FootnoteRef n={2} scope="ds" />.
            </p>
            <MarginNote marker={1} label="Capture rate">
              We multiply by <strong className="tr-num">0.7</strong>. Review, exceptions and setup still take time.
            </MarginNote>
            <Footnotes
              scope="ds"
              items={[
                { n: 1, content: 'Capture rate 0.7, stated in the methodology.' },
                { n: 2, content: 'Weekly hours use a 7-day calendar week, not a 5-day work week.' },
              ]}
            />
          </div>
        </Specimen>
      </Section>

      <Section n={6} id="overlays" title="Tooltip, popover, dialog, tabs" note={<>All keyboard reachable. Tooltips show on focus; Escape closes everything and returns focus to where it came from.</>}>
        <div className="ds-grid2">
          <Specimen label="Tooltip" state="open (static)">
            <div className="ds-pad-top">
              <Tooltip content="Share of steps that are mechanical: copy, paste, export, fill." defaultOpen>
                <button type="button" className="tr-link ds-plain-btn">
                  Rule-based share
                </button>
              </Tooltip>
            </div>
          </Specimen>
          <Specimen label="Tooltip" state="live: hover or Tab to it">
            <Tooltip content="Confidence rises with occurrences and distinct days.">
              <button type="button" className="tr-link ds-plain-btn">
                What is confidence?
              </button>
            </Tooltip>
          </Specimen>
          <Specimen label="Popover" state="open (static)">
            <div className="ds-pop-room">
              <Popover label="Why 0.7?" title="Capture rate" defaultOpen>
                <p>Automation never removes all of the time. Someone reviews the output, handles exceptions and fixes the setup when an app changes.</p>
              </Popover>
            </div>
          </Specimen>
          <Specimen label="Dialog" state="live">
            <DialogDemo />
          </Specimen>
        </div>
        <Specimen label="Confirm delete dialog" state="static, word not yet typed" wide>
          <InlineConfirmDemo />
        </Specimen>
        <Specimen label="Dialog" state="plain, long content" wide>
          <InlineDialogDemo />
        </Specimen>
        <Specimen label="Tabs" state="← → Home End" wide>
          <Tabs
            label="Report sections"
            items={[
              { id: 'f', label: 'Findings', count: 5, content: <p>Five workflows repeated at least three times.</p> },
              { id: 'm', label: 'Method', content: <p>How each number was computed, and what we could not see.</p> },
              { id: 'p', label: 'Privacy', content: <p>What was recorded and what was not.</p> },
              { id: 'x', label: 'Exports', disabled: true, content: null },
            ]}
          />
        </Specimen>
      </Section>

      <Section n={7} id="states" title="Loading, empty, error" note={<>Loading looks like a page being ruled. Empty is a blank page with one plain sentence. Errors say what happened, what is safe, and what to do.</>}>
        <div className="ds-grid2">
          <Specimen label="Ruled skeleton" state="loading">
            <RuledSkeleton label="Reading your week" />
          </Specimen>
          <Specimen label="Empty state">
            <EmptyState title="No audits yet" action={<Button trailing="→">Start a 7-day audit</Button>}>
              An audit watches how you work for a week, then shows what repeats.
            </EmptyState>
          </Specimen>
          <Specimen label="Error state" state="with retry">
            <ErrorDemo />
          </Specimen>
          <Specimen label="Error state" state="no retry">
            <ErrorState title="This audit was cancelled" code="audit_window_closed">
              Events after the window closed were discarded on your Mac.
            </ErrorState>
          </Specimen>
        </div>
        <Specimen label="Notices" state="info · success · warning · error · dismissable" wide>
          <div className="ds-stack">
            <Notice tone="info">Your report is being written. This usually takes two to four minutes.</Notice>
            <Notice tone="success" title="Device paired">
              Mara’s MacBook Pro will start recording on Monday at 08:00.
            </Notice>
            <NoticeDemo />
            <Notice tone="error" title="Upload rejected" action={<TextLink href="#">See which events</TextLink>}>
              412 events were older than the audit window and were not stored.
            </Notice>
          </div>
        </Specimen>
        <Specimen label="Toasts" state="live, bottom left, pause on hover">
          <ToastDemo />
        </Specimen>
      </Section>

      <Section n={8} id="stat" title="Stat figure" note={<>One hero number per view, with a hand-drawn vermilion underline. It counts up once when scrolled into view; never under reduced motion. Screen readers get the final value.</>}>
        <Specimen label="Hero" state="count-up, underline, calculation" wide>
          <StatFigure
            value={report.summary.reclaimableHoursPerWeek}
            unit="h / week"
            label="Reclaimable time"
            underline
            caption="Across five repeated workflows, after a 30% haircut for review and exceptions."
            calculation={report.summary.calculation}
          />
        </Specimen>
        <div className="ds-grid2">
          <Specimen label="Large" state="no count-up">
            <StatFigure size="large" value={31.6} unit="h observed" label="Active time" countUp={false} caption="Paused time and excluded apps are not included." />
          </Specimen>
          <Specimen label="Medium" state="pending">
            <StatFigure size="medium" value={0} pending label="Reclaimable time" caption="Computed when the audit ends on Sunday." />
          </Specimen>
        </div>
        <Specimen label="Calculation table" state="open" wide>
          <CalcSteps steps={report.summary.calculation} />
        </Specimen>
      </Section>

      <Section n={9} id="ledger" title="Ledger" note={<>Ranked by reclaimable time. Tab into the ledger once, then ↑ ↓ to move and Enter to open. Sorting keeps the vermilion on the top finding, not on row one.</>}>
        <Specimen label="Ledger" state="sortable, one row open" wide>
          <LedgerTable rows={rows} caption="Repeated workflows, ranked" highlightId={report.summary.topFindingId} sortable defaultExpanded={[top.id]} />
        </Specimen>
        <Specimen label="Ledger" state="long labels" wide>
          <LedgerTable rows={longRows} caption="Long content" highlightId={report.summary.topFindingId} />
        </Specimen>
        <Specimen label="Ledger" state="loading" wide>
          <LedgerTable rows={[]} loading caption="Ranked workflows" />
        </Specimen>
        <Specimen label="Ledger" state="empty" wide>
          <LedgerTable rows={[]} caption="Ranked workflows" />
        </Specimen>
        <Specimen label="Ledger" state="error" wide>
          <LedgerErrorDemo rows={rows} />
        </Specimen>
      </Section>

      <Section n={10} id="week" title="Week strip" note={<>Days across, workflows down. A tick is one occurrence at its time of day; width is duration. Weekends are shaded. Every strip has a table view.</>}>
        <Specimen label="7 days" wide>
          <WeekStrip rows={weekRowsFromReport(report)} startsAt={report.window.startsAt} days={7} caption="When each workflow happened, 16–22 November" />
        </Specimen>
        <Specimen label="14 days" wide>
          <WeekStrip rows={twoWeeks} startsAt={report.window.startsAt} days={14} caption="Two-week audit" />
        </Specimen>
        <Specimen label="Table view" wide>
          <WeekStrip rows={weekRowsFromReport(report).slice(0, 3)} startsAt={report.window.startsAt} days={7} caption="Same data, as a table" defaultView="table" />
        </Specimen>
        <div className="ds-grid2">
          <Specimen label="Loading">
            <WeekStrip rows={[]} loading startsAt={report.window.startsAt} days={7} caption="When each workflow happened" />
          </Specimen>
          <Specimen label="Empty">
            <WeekStrip rows={[]} startsAt={report.window.startsAt} days={7} caption="When each workflow happened" />
          </Specimen>
        </div>
      </Section>

      <Section n={11} id="path" title="Path trail" note={<>Typographic, not iconographic. The verb is what happened; the app is where.</>}>
        <Specimen label="Full" wide>
          <PathTrail steps={top.path} />
        </Specimen>
        <Specimen label="Long path, wraps" wide>
          <PathTrail
            steps={[
              { appKey: 'gmail', action: 'read', label: 'Open supplier email' },
              { appKey: 'pdf_viewer', action: 'download', label: 'Save invoice PDF' },
              { appKey: 'finder', action: 'edit', label: 'Rename file' },
              { appKey: 'google_drive', action: 'upload', label: 'File in Drive' },
              { appKey: 'xero', action: 'import', label: 'Create bill' },
              { appKey: 'slack', action: 'compose', label: 'Tell bookkeeper' },
            ]}
          />
        </Specimen>
        <Specimen label="Compact" state="ledger rows">
          <PathTrail steps={second.path} variant="compact" />
        </Specimen>
      </Section>

      <Section n={12} id="score" title="Score breakdown" note={<>Five inputs as instrument scales. The formula is printed with the real numbers, using the same code as the pipeline.</>}>
        <Specimen label="Top finding" state="risk flag" wide>
          <ScoreBreakdown breakdown={top.score} />
        </Specimen>
        <Specimen label="Low confidence" wide>
          <ScoreBreakdown breakdown={last.score} />
        </Specimen>
      </Section>

      <Section n={13} id="recipe" title="Recipe" note={<>A protocol: what you need, numbered steps, and where a human stays in charge.</>}>
        <Specimen label="Recipe" wide>
          <RecipeSteps recipe={top.recipe} id="ds-recipe" />
        </Specimen>
      </Section>

      <Section n={14} id="tools" title="Tool options" note={<>Ranked by fit only. The build-it-yourself option is always first and set at the same weight. Affiliate links say so beside the link.</>}>
        <Specimen label="Tools with affiliate disclosure" wide>
          <ToolOptions tools={top.tools} diy={top.diyOption} recipeHref="#ds-recipe" />
        </Specimen>
        <Specimen label="No tool fits" state="empty" wide>
          <ToolOptions tools={[]} diy={last.diyOption} recipeHref="#ds-recipe" />
        </Specimen>
      </Section>

      <Section n={15} id="finding" title="Findings" note={<>Numbered like entries in a record. The top finding’s number is the only vermilion on its page.</>}>
        <Specimen label="Finding cards" state="contents list" wide>
          <div>
            {report.findings.map((f, i) => (
              <FindingCard key={f.id} finding={f} index={i + 1} top={i === 0} href={`/design/report#${f.id}`} />
            ))}
          </div>
        </Specimen>
        <Specimen label="Finding section" state="header, narrative, metrics, path" wide>
          <FindingSection
            finding={second}
            index={2}
            daysObserved={report.window.daysObserved}
            headingLevel={3}
            notes={
              <MarginNote label="Method">
                Counted when Shopify and the packing sheet were used together within <span className="tr-num">5</span> minutes.
              </MarginNote>
            }
          />
        </Specimen>
      </Section>

      <Section n={16} id="capture" title="Capture" note={<>Live status shows counts only, never contents.</>}>
        <Specimen label="Countdown badge" state="recording · paused · analysing · complete" wide>
          <Row>
            <CountdownBadge day={3} total={7} />
            <CountdownBadge day={5} total={7} status="paused" />
            <CountdownBadge day={14} total={14} status="analyzing" />
            <CountdownBadge day={7} total={7} status="complete" />
          </Row>
        </Specimen>
        <Specimen label="Progress rule" wide>
          <div className="ds-stack">
            <ProgressRule value={3} max={7} ticks={7} label="Capture" reading="Day 3 of 7" caption="2,914 events received · last upload 4 minutes ago" />
            <ProgressRule value={6} max={8} label="Writing the report" reading="Stage 6 of 8: narrate" />
          </div>
        </Specimen>
      </Section>

      <Section n={17} id="privacy" title="Privacy" note={<>Plain lists, struck-through where something is never recorded. The deletion receipt is designed to be printed and kept.</>}>
        <Specimen label="Privacy ledger" wide>
          <PrivacyLedger captured={samplePrivacy.captured} notCaptured={samplePrivacy.notCaptured} />
        </Specimen>
        <Specimen label="Access log" wide>
          <AccessLogTable entries={sampleAccessLog} />
        </Specimen>
        <div className="ds-grid2">
          <Specimen label="Access log" state="empty">
            <AccessLogTable entries={[]} />
          </Specimen>
          <Specimen label="Access log" state="error">
            <AccessErrorDemo />
          </Specimen>
        </div>
        <Specimen label="Deletion receipt" wide>
          <div className="ds-receipt-room">
            <DeletionReceipt receipt={sampleDeletionReceipt} />
          </div>
        </Specimen>
      </Section>

      <Section n={18} id="dark" title="Paper and kraft" note={<>Side by side, the same components. Kraft is a warm brown-black with cream ink; the vermilion brightens a step to keep 3:1.</>}>
        <Pair>
          <div className="ds-stack">
            <StatFigure size="large" value={report.summary.reclaimableHoursPerWeek} unit="h / week" label="Reclaimable" underline countUp={false} />
            <Row>
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Delete</Button>
            </Row>
            <TextField label="Pairing code" mono defaultValue="7KQ-2M" error="That code expired." />
            <LedgerTable rows={rows.slice(0, 3)} caption="Top three" highlightId={report.summary.topFindingId} />
            <Notice tone="error" title="Upload failed">
              Retrying in 5 minutes.
            </Notice>
          </div>
        </Pair>
      </Section>

      <footer className="ds-foot">
        <Rule weight="double" />
        <p className="tr-kicker">End of record · {report.findings.length} findings in the sample · built from @tracer/ui</p>
      </footer>
    </div>
  );
}
