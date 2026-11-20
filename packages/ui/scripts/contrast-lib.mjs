// WCAG 2.x relative luminance and contrast ratio. No dependencies.

export function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rows for every pair in every mode. */
export function contrastRows(color, pairs) {
  const rows = [];
  for (const mode of Object.keys(color)) {
    for (const p of pairs) {
      const fg = color[mode][p.fg];
      const bg = color[mode][p.bg];
      const ratio = contrast(fg, bg);
      rows.push({ mode, fg: p.fg, bg: p.bg, fgHex: fg, bgHex: bg, ratio, min: p.min, use: p.use, pass: ratio >= p.min });
    }
  }
  return rows;
}

export function contrastMarkdown(rows) {
  const head = '| Mode | Foreground | Background | Ratio | Needs | Result | Use |\n|---|---|---|---:|---:|---|---|';
  const body = rows
    .map((r) => {
      const need = r.min === 0 ? 'exempt' : `${r.min}:1`;
      const res = r.min === 0 ? 'n/a' : r.pass ? 'pass' : '**FAIL**';
      return `| ${r.mode} | \`${r.fg}\` ${r.fgHex} | \`${r.bg}\` ${r.bgHex} | ${r.ratio.toFixed(2)}:1 | ${need} | ${res} | ${r.use} |`;
    })
    .join('\n');
  return `${head}\n${body}`;
}
