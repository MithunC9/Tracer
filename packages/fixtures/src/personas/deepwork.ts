import { axd, nat, NATIVE, type Ctx, type Filler } from '../engine.js';
import { dur, split } from './common.js';

/** VS Code session hopping across files; opening `.env` plants provider keys. */
export function vscodeWork(project: string, files: string[], envKeys: ((c: Ctx) => string)[]): Filler {
  return (c, budget) => {
    const total = dur(c, budget, 600, 3000);
    for (const part of split(c, total, c.r.int(2, 6))) {
      const env = envKeys.length > 0 && c.r.chance(0.12);
      const file = env ? '.env' : c.r.pick(files);
      const text = env
        ? envKeys.map((k) => k(c)).join('\n')
        : `export function ${c.r.pick(['render', 'useInvoice', 'formatDate', 'handleSubmit', 'fetchProjects'])}(props) {\n  const [state, setState] = useState(null);\n  // TODO: tidy up\n}`;
      c.sim.dwell(nat(NATIVE.vscode, `${file} — ${project}`, [axd([file, 'EXPLORER'], ['Source Control', 'Run and Debug', 'Problems'], text)]), part, {
        axEvery: [30, 90],
        flicker: [nat(NATIVE.slack, null), nat(NATIVE.iterm, `zsh — ${project}`)],
        flickerP: 0.1,
        clips: c.r.int(0, 1),
      });
    }
  };
}

export function terminalWork(project: string, secretLines: ((c: Ctx) => string)[]): Filler {
  return (c, budget) => {
    const lines = ['$ pnpm test\n✓ 42 passed', '$ git status\nOn branch main', '$ npm run dev\nready on port 3000'];
    let text = c.r.pick(lines);
    if (secretLines.length && c.r.chance(0.35)) text += '\n' + c.r.pick(secretLines)(c);
    c.sim.dwell(nat(NATIVE.iterm, `zsh — ${project}`, [axd([`zsh — ${project}`], ['Shell'], text)]), dur(c, budget, 60, 600), { axEvery: [15, 60], clips: c.r.int(0, 1) });
  };
}

export function figmaWork(files: string[]): Filler {
  return (c, budget) => {
    const total = dur(c, budget, 900, 3600);
    for (const part of split(c, total, c.r.int(1, 3))) {
      const f = c.r.pick(files);
      c.sim.dwell(nat(NATIVE.figma, `${f} – Figma`, [axd([f, 'Layers', 'Design'], ['Frame', 'Auto layout', 'Prototype', 'Comments'], `Frame ${c.r.int(1, 40)} · ${c.r.pick(['Desktop', 'Mobile', 'Tablet'])}`)]), part, {
        axEvery: [40, 120],
        flicker: [nat(NATIVE.slack, null), nat(NATIVE.spotify, 'Spotify Premium')],
        flickerP: 0.08,
      });
    }
  };
}
