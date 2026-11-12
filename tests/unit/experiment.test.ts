import { describe, expect, it } from 'vitest';
import { UUID_PATTERN, VARIANTS, assignVariant, isVariant } from '../../src/lib/experiment';

describe('assignVariant', () => {
  it('is deterministic: the same visitor id always gets the same arm', () => {
    const id = crypto.randomUUID();
    const first = assignVariant(id);
    for (let i = 0; i < 20; i++) expect(assignVariant(id)).toBe(first);
  });

  it('only ever returns a known variant', () => {
    for (let i = 0; i < 500; i++) expect(VARIANTS).toContain(assignVariant(crypto.randomUUID()));
  });

  it('splits ~50/50 across random visitor ids (10k ids, within 2 percentage points)', () => {
    const counts = { control: 0, email_only: 0 };
    const n = 10_000;
    for (let i = 0; i < n; i++) counts[assignVariant(crypto.randomUUID())]++;
    expect(counts.control / n).toBeGreaterThan(0.48);
    expect(counts.control / n).toBeLessThan(0.52);
    expect(counts.control + counts.email_only).toBe(n);
  });
});

describe('guards', () => {
  it('isVariant accepts only the two arms', () => {
    expect(isVariant('control')).toBe(true);
    expect(isVariant('email_only')).toBe(true);
    for (const bad of ['Control', '', undefined, null, 1, 'email-only']) expect(isVariant(bad)).toBe(false);
  });

  it('UUID_PATTERN accepts a real uuid and rejects junk', () => {
    expect(UUID_PATTERN.test(crypto.randomUUID())).toBe(true);
    for (const bad of ['', 'not-a-uuid', 'a@b.co', "' OR 1=1 --"]) expect(UUID_PATTERN.test(bad)).toBe(false);
  });
});
