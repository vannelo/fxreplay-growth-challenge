/** Experiment `signup_fields` (ADR-004): control = email + name, email_only = email. Pure, shared by middleware and tests. */
export const EXPERIMENT = 'signup_fields';
export const VARIANTS = ['control', 'email_only'] as const;
export type Variant = (typeof VARIANTS)[number];

export const VISITOR_COOKIE = 'fxr_vid';
export const VARIANT_COOKIE = 'fxr_variant';

export const isVariant = (value: unknown): value is Variant => VARIANTS.includes(value as Variant);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic 50/50 split from the visitor id. The experiment name is salted in so two experiments
 * never share the same split. FNV-1a (32-bit): tiny, synchronous, runs unchanged at the edge.
 */
export function assignVariant(visitorId: string): Variant {
  let hash = 0x811c9dc5;
  for (const char of `${EXPERIMENT}:${visitorId}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return VARIANTS[(hash >>> 0) % VARIANTS.length]!;
}
