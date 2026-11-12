import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/* ---------- resolve semantic tokens to hex ---------- */
const tokens = new Map<string, string>();
for (const [, name, value] of read('src/styles/tokens.css').matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens.set(name!, value!.trim());

function resolve(name: string): string {
  let value = tokens.get(name);
  for (let i = 0; i < 10 && value; i++) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref) break;
    value = tokens.get(ref[1]!);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`token --${name} does not resolve to a hex colour (got ${value})`);
  return value;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('colour contrast of the token pairs the UI actually uses (WCAG 2.2 AA)', () => {
  // [foreground, background, minimum ratio, why]
  const pairs: [string, string, number, string][] = [
    ['text-primary', 'bg-primary', 4.5, 'body text on the page'],
    ['text-secondary', 'bg-primary', 4.5, 'secondary text on the page'],
    ['text-link', 'bg-primary', 4.5, 'inline brand text (text-brand fails: see brand-questions.md)'],
    ['text-error', 'bg-primary', 4.5, 'error text on the page'],
    ['text-primary', 'card-bg-secondary', 4.5, 'text on the form card'],
    ['text-secondary', 'card-bg-secondary', 4.5, 'secondary text on the form card'],
    ['text-error', 'card-bg-secondary', 4.5, 'inline field errors on the form card'],
    ['text-link', 'card-bg-secondary', 4.5, 'sign-in link on the form card'],
    ['text-primary', 'bg-secondary', 4.5, 'typed text inside inputs'],
    ['btn-text', 'btn-bg-primary-active', 4.5, 'primary button label'],
    ['btn-text', 'btn-bg-primary-hover', 4.5, 'primary button label, hover'],
    ['btn-text', 'btn-bg-primary-pressed', 4.5, 'primary button label, pressed'],
    ['field-border', 'card-bg-secondary', 3, 'input border on the card (1.4.11 non-text)'],
    ['field-border-error', 'card-bg-secondary', 3, 'invalid input border on the card'],
    ['field-border', 'bg-primary', 3, 'input border on the page'],
    ['border-brand', 'bg-primary', 3, 'focus ring on the page'],
    ['border-brand', 'card-bg-secondary', 3, 'focus ring on the card'],
  ];
  it.each(pairs)('%s on %s ≥ %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(min);
  });

  it('documents the known failure: text-brand on bg-primary is below AA for body text, which is why text-link exists', () => {
    expect(contrast(resolve('text-brand'), resolve('bg-primary'))).toBeLessThan(4.5);
  });
});

describe('design-token hygiene', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  const sources = files('src').filter((f) => /\.(astro|tsx|ts|css)$/.test(f) && !f.endsWith('styles/tokens.css'));

  it('no raw colour literals (hex, rgb(), hsl()) outside tokens.css: components use semantic tokens only', () => {
    const offenders = sources.flatMap((f) =>
      read(f)
        .split('\n')
        .map((line, i) => ({ f, line: i + 1, text: line }))
        .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text)),
    );
    expect(offenders.map((o) => `${o.f}:${o.line} ${o.text.trim()}`)).toEqual([]);
  });

  it('only the brand fonts are referenced', () => {
    const css = sources.map(read).join('\n');
    for (const forbidden of ['Inter', 'Roboto', 'Arial Black', 'system-ui', 'JetBrains']) expect(css).not.toContain(`'${forbidden}'`);
  });
});
