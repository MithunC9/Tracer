import { ImageResponse } from 'next/og';

export const alt = 'Tracer: a time-boxed audit of how you actually work';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#F4F1EA';
const INK = '#14130F';
const GRAPHITE = '#5C564B';
const RULE = '#CDC4B2';
const SIGNAL = '#E8431E';

/** Fetch a Google font subset as TTF (satori cannot read woff2). Falls back to the default font. */
async function font(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const headline = 'How you actually work, measured.';
  const figure = '4.8';
  const small = 'TRACER · EFFICIENCY AUDIT · FINDING 01 h/week reclaimable 7 days observed';
  const [serif, mono] = await Promise.all([font('Instrument+Serif', headline + 'Tracer'), font('Geist+Mono', small + figure + '0123456789')]);
  const fonts = [
    ...(serif ? [{ name: 'Instrument Serif', data: serif, weight: 400 as const, style: 'normal' as const }] : []),
    ...(mono ? [{ name: 'Geist Mono', data: mono, weight: 400 as const, style: 'normal' as const }] : []),
  ];

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: PAPER, color: INK, padding: '56px 72px', position: 'relative' }}>
        {/* column guides */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 72, right: 72, display: 'flex', justifyContent: 'space-between' }}>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} style={{ width: 1, height: '100%', background: RULE, opacity: 0.6 }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'Geist Mono', fontSize: 20, letterSpacing: 3, color: GRAPHITE, borderBottom: `2px solid ${INK}`, paddingBottom: 14 }}>
          <span>TRACER · EFFICIENCY AUDIT</span>
          <span>7 days observed</span>
        </div>
        <div style={{ display: 'flex', fontFamily: 'Instrument Serif', fontSize: 96, lineHeight: 0.95, marginTop: 48, maxWidth: 820, letterSpacing: -2 }}>{headline}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 'auto', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 150, lineHeight: 0.85, letterSpacing: -8 }}>
              {figure.split('.').map((part, i) => (
                <span key={i} style={{ display: 'flex' }}>
                  {i > 0 ? <span style={{ marginLeft: -22, marginRight: -22 }}>.</span> : null}
                  {part}
                </span>
              ))}
            </div>
            <div style={{ height: 8, background: SIGNAL, marginTop: 14, width: '104%' }} />
          </div>
          <span style={{ fontFamily: 'Geist Mono', fontSize: 26, color: GRAPHITE, paddingBottom: 26 }}>h/week reclaimable</span>
          <svg width="220" height="70" viewBox="0 0 220 70" style={{ marginLeft: 'auto' }}>
            <path d="M0 68 H220" stroke={INK} strokeWidth="2" />
            <path d="M20 68 V40 M70 68 V18 M120 68 V30 M170 68 V8" stroke={INK} strokeWidth="6" />
          </svg>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
