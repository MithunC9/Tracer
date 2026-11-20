import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AFFILIATE_DISCLOSURE } from '@tracer/schema';

// Motion's reduced-motion hook is controlled per test.
const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (orig) => {
  const mod = await orig<typeof import('motion/react')>();
  return { ...mod, useReducedMotion: () => reduced.value };
});

import { ConfirmDeleteDialog, LedgerTable, StatFigure, Tabs, ToolOptions, WeekStrip, ledgerRowsFromReport, weekRowsFromReport } from '../src/index.js';
import { sampleReport } from '../src/fixtures/index.js';

beforeEach(() => {
  reduced.value = false;
});

const rows = ledgerRowsFromReport(sampleReport, (f) => <p>Detail for {f.label}</p>);

describe('LedgerTable', () => {
  it('has one tab stop and moves focus with arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<LedgerTable rows={rows} caption="Ranked" />);
    const buttons = screen.getAllByRole('button', { expanded: false });
    expect(buttons).toHaveLength(rows.length);
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);

    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(buttons[3]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(buttons[2]).toHaveFocus();
    await user.keyboard('{End}');
    expect(buttons[rows.length - 1]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(buttons[0]).toHaveFocus();
    // roving tabindex follows focus
    expect(buttons[0]!.tabIndex).toBe(0);
    expect(buttons[1]!.tabIndex).toBe(-1);
  });

  it('expands and collapses a row with Enter, revealing its detail', async () => {
    const user = userEvent.setup();
    render(<LedgerTable rows={rows} caption="Ranked" />);
    const first = screen.getAllByRole('button', { expanded: false })[0]!;
    expect(screen.queryByText(`Detail for ${rows[0]!.label}`)).toBeNull();
    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(`Detail for ${rows[0]!.label}`)).toBeInTheDocument();
    expect(document.getElementById(first.getAttribute('aria-controls')!)).not.toBeNull();
  });

  it('expands instantly under reduced motion (no height animation)', async () => {
    reduced.value = true;
    const user = userEvent.setup();
    render(<LedgerTable rows={rows} caption="Ranked" />);
    const first = screen.getAllByRole('button', { expanded: false })[0]!;
    await user.click(first);
    const region = document.getElementById(first.getAttribute('aria-controls')!)!;
    // With a zero-duration transition the region is at its final state on the first frame.
    expect(region.style.opacity === '' || region.style.opacity === '1').toBe(true);
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('sorts by a header and keeps the highlight on the same entity', async () => {
    const user = userEvent.setup();
    const top = sampleReport.summary.topFindingId!;
    render(<LedgerTable rows={rows} caption="Ranked" sortable highlightId={top} />);
    await user.click(screen.getByRole('button', { name: /Automatable/ }));
    const th = screen.getByRole('columnheader', { name: /Automatable/ });
    expect(th).toHaveAttribute('aria-sort', 'descending');
    const body = screen.getAllByRole('row').slice(1);
    // highest automation potential first
    const maxAp = Math.max(...rows.map((r) => r.automationPotential));
    expect(within(body[0]!).getByText(String(maxAp))).toBeInTheDocument();
    const signalled = document.querySelector('tr[data-signal]')!;
    expect(signalled.textContent).toContain(rows.find((r) => r.id === top)!.label);
  });

  it('renders loading, empty and error states', () => {
    const { rerender } = render(<LedgerTable rows={[]} caption="Ranked" loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Ranking workflows');
    rerender(<LedgerTable rows={[]} caption="Ranked" />);
    expect(screen.getByText('No repeated workflows found')).toBeInTheDocument();
    rerender(<LedgerTable rows={[]} caption="Ranked" error={{ title: 'Could not rank' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not rank');
  });
});

describe('StatFigure', () => {
  it('server-renders the final value, and assistive tech always gets it', () => {
    const html = renderToString(<StatFigure value={4.8} unit="h / week" label="Reclaimable" />);
    expect(html).toContain('data-count="pending"');
    expect(html.replace(/<[^>]+>/g, '')).toContain('4.8');
    render(<StatFigure value={4.8} unit="h / week" label="Reclaimable" />);
    // the visually hidden copy is the final value even while the visual copy counts
    expect(screen.getByRole('figure').querySelector('.tr-vh')!.textContent).toBe('4.8 h / week');
  });

  it('does not count up under reduced motion', () => {
    reduced.value = true;
    render(<StatFigure value={12.5} unit="h" />);
    const fig = screen.getByRole('figure');
    expect(fig.querySelector('.tr-stat__value')!.textContent).toBe('12.5');
    expect(fig).toHaveAttribute('data-count', 'done');
  });

  it('counts up once from zero and ends on the final value', async () => {
    const { rerender } = render(<StatFigure value={4.8} unit="h" />);
    const fig = screen.getByRole('figure');
    expect(fig).toHaveAttribute('data-count', 'running');
    await waitFor(() => expect(fig).toHaveAttribute('data-count', 'done'), { timeout: 4000 });
    expect(fig.querySelector('.tr-stat__value')!.textContent).toBe('4.8');
    // a re-render does not start it again
    rerender(<StatFigure value={4.8} unit="h" />);
    expect(fig).toHaveAttribute('data-count', 'done');
  });

  it('shows the calculation in a disclosure', async () => {
    const user = userEvent.setup();
    render(<StatFigure value={sampleReport.summary.reclaimableHoursPerWeek} calculation={sampleReport.summary.calculation} countUp={false} />);
    const btn = screen.getByRole('button', { name: 'Show calculation' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table')).toHaveTextContent('Reclaimable per week');
  });
});

describe('ToolOptions', () => {
  const f = sampleReport.findings[0]!;
  it('always shows the DIY option and labels affiliate links', () => {
    render(<ToolOptions tools={f.tools} diy={f.diyOption} recipeHref="#recipe" />);
    expect(screen.getByRole('heading', { name: 'Build it yourself with this recipe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the recipe' })).toHaveAttribute('href', '#recipe');
    const affiliates = f.tools.filter((t) => t.affiliate);
    expect(affiliates.length).toBeGreaterThan(0);
    expect(screen.getAllByText('We may earn a commission')).toHaveLength(affiliates.length);
    expect(screen.getAllByText(AFFILIATE_DISCLOSURE).length).toBe(affiliates.length);
    for (const t of affiliates) {
      const link = screen.getByRole('link', { name: new RegExp(`Visit ${t.name}`) });
      expect(link).toHaveAttribute('rel', expect.stringContaining('sponsored'));
    }
  });

  it('keeps the DIY option when no tool fits', () => {
    render(<ToolOptions tools={[]} diy={f.diyOption} recipeHref="#recipe" />);
    expect(screen.getByRole('heading', { name: 'Build it yourself with this recipe' })).toBeInTheDocument();
    expect(screen.getByText('No tool fits well enough')).toBeInTheDocument();
  });
});

describe('WeekStrip', () => {
  it('switches to an accessible table with per-day counts', async () => {
    const user = userEvent.setup();
    render(<WeekStrip rows={weekRowsFromReport(sampleReport)} startsAt={sampleReport.window.startsAt} days={7} caption="The week" />);
    expect(screen.getAllByRole('img').length).toBe(sampleReport.findings.length);
    await user.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'The week' });
    const f = sampleReport.findings[0]!;
    const row = within(table).getByRole('row', { name: new RegExp(f.label) });
    expect(row).toHaveTextContent(`${f.metrics.occurrences}×`);
  });
});

describe('Tabs and dialog', () => {
  it('tabs move with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Sections"
        items={[
          { id: 'a', label: 'A', content: <p>Panel A</p> },
          { id: 'b', label: 'B', content: <p>Panel B</p> },
        ]}
      />,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Panel B')).toBeVisible();
  });

  it('delete stays disabled until the confirm word is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDeleteDialog inline open onClose={() => {}} onConfirm={onConfirm} subject="all audit data" />);
    const del = screen.getByRole('button', { name: 'Delete permanently' });
    expect(del).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'delete');
    expect(del).toBeEnabled();
    fireEvent.click(del);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
