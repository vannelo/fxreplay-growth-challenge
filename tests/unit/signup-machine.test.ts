import { describe, expect, it } from 'vitest';
import {
  MESSAGES,
  announcement,
  initialState,
  isRetryable,
  reduce,
  type Action,
  type Outcome,
  type SignupState,
} from '../../src/components/signup/signup-machine';

const run = (state: SignupState, ...actions: Action[]) => actions.reduce(reduce, state);
const fill = (email: string, name = ''): Action[] => [
  { type: 'edit', field: 'email', value: email },
  { type: 'edit', field: 'name', value: name },
];
/** edit → submit → validated → (still in `submitting`) */
const submitWith = (state: SignupState, key: string) =>
  run(state, { type: 'submit' }, { type: 'validated', newKey: key });
const withOutcome = (state: SignupState, outcome: Outcome) => run(state, { type: 'outcome', outcome });

const submitting = (key = 'key-1', email = 'ada@example.com', name = '') =>
  submitWith(run(initialState, ...fill(email, name)), key);

describe('validation', () => {
  it('submit enters `validating`; an invalid email lands in fieldError with a message', () => {
    const s = run(initialState, ...fill('nope'), { type: 'submit' });
    expect(s.status).toBe('validating');
    const out = reduce(s, { type: 'validated', newKey: 'k' });
    expect(out.status).toBe('fieldError');
    expect(out.errors.email).toBeTruthy();
    expect(out.pending).toBeNull();
  });

  it('an invalid name is reported on `name`, and both fields can fail together', () => {
    const s = submitWith(run(initialState, ...fill('nope', 'x'.repeat(81))), 'k');
    expect(s.status).toBe('fieldError');
    expect(Object.keys(s.errors).sort()).toEqual(['email', 'name']);
  });

  it('a valid form is normalized (trim + lowercase email, blank name omitted) and enters `submitting`', () => {
    const s = submitWith(run(initialState, ...fill('  ADA@Example.COM ', '   ')), 'k1');
    expect(s.status).toBe('submitting');
    expect(s.pending).toEqual({ key: 'k1', payload: { email: 'ada@example.com' }, reusable: false });
  });

  it('keeps a provided name (trimmed) in the payload', () => {
    const s = submitWith(run(initialState, ...fill('a@b.co', '  Ada ')), 'k1');
    expect(s.pending?.payload).toEqual({ email: 'a@b.co', name: 'Ada' });
  });

  it('user input is preserved through every error', () => {
    const s = submitWith(run(initialState, ...fill('nope', 'Ada')), 'k');
    expect(s.values).toEqual({ email: 'nope', name: 'Ada' });
  });

  it('editing a field clears only that field’s error and returns to idle', () => {
    const failed = submitWith(run(initialState, ...fill('nope', 'x'.repeat(81))), 'k');
    const edited = reduce(failed, { type: 'edit', field: 'email', value: 'ok@x.co' });
    expect(edited.status).toBe('idle');
    expect(edited.errors.email).toBeUndefined();
    expect(edited.errors.name).toBeTruthy();
  });
});

describe('attempt counter (a repeat of the same failure must stay observable)', () => {
  it('increments on every validated submit, including a repeat of the identical invalid form', () => {
    const first = submitWith(run(initialState, ...fill('nope')), 'k');
    const second = submitWith(first, 'k');
    expect(second.errors).toEqual(first.errors);
    expect(second.attempt).toBe(first.attempt + 1);
  });

  it('is not bumped by edits, ignored submits or outcomes', () => {
    const s = submitting();
    expect(reduce(s, { type: 'submit' }).attempt).toBe(s.attempt);
    expect(withOutcome(s, { kind: 'network' }).attempt).toBe(s.attempt);
    expect(reduce(initialState, { type: 'edit', field: 'email', value: 'x' }).attempt).toBe(0);
  });
});

describe('double-submit and in-flight guards', () => {
  it('ignores submit, validated and edits while submitting', () => {
    const s = submitting();
    expect(reduce(s, { type: 'submit' })).toBe(s);
    expect(reduce(s, { type: 'validated', newKey: 'other' })).toBe(s);
    expect(reduce(s, { type: 'edit', field: 'email', value: 'x@y.co' })).toBe(s);
  });

  it('ignores `validated` unless validating, and outcomes unless submitting', () => {
    expect(reduce(initialState, { type: 'validated', newKey: 'k' })).toBe(initialState);
    expect(withOutcome(initialState, { kind: 'created' })).toBe(initialState);
  });

  it('is terminal after success', () => {
    const done = withOutcome(submitting(), { kind: 'created' });
    expect(done.status).toBe('success');
    expect(reduce(done, { type: 'submit' })).toBe(done);
    expect(reduce(done, { type: 'edit', field: 'email', value: 'x@y.co' })).toBe(done);
  });
});

describe('outcomes → states', () => {
  it('created → success, pending cleared', () => {
    const s = withOutcome(submitting(), { kind: 'created' });
    expect(s).toMatchObject({ status: 'success', pending: null });
  });

  it('409 → serverError(email_taken), email flagged, input kept', () => {
    const s = withOutcome(submitting('k', 'ada@example.com', 'Ada'), { kind: 'email_taken' });
    expect(s).toMatchObject({ status: 'serverError', failure: 'email_taken' });
    expect(s.errors.email).toBe(MESSAGES.emailTaken);
    expect(s.values).toEqual({ email: 'ada@example.com', name: 'Ada' });
  });

  it('422 with known fields → fieldError with the server messages', () => {
    const s = withOutcome(submitting(), { kind: 'validation', fields: { email: ['Enter a valid email address'] } });
    expect(s.status).toBe('fieldError');
    expect(s.errors).toEqual({ email: 'Enter a valid email address' });
  });

  it('422 with no user-fixable field (e.g. _form / header) → generic serverError', () => {
    const s = withOutcome(submitting(), { kind: 'validation', fields: { _form: ['x'], 'idempotency-key': ['y'] } });
    expect(s).toMatchObject({ status: 'serverError', failure: 'unavailable' });
  });

  it('429 → serverError(rate_limited) carrying Retry-After', () => {
    const s = withOutcome(submitting(), { kind: 'rate_limited', retryAfter: 30 });
    expect(s).toMatchObject({ status: 'serverError', failure: 'rate_limited', retryAfter: 30 });
    expect(announcement(s)).toContain('30 seconds');
  });

  it('5xx → serverError(unavailable); network → networkError', () => {
    expect(withOutcome(submitting(), { kind: 'unavailable' })).toMatchObject({ status: 'serverError', failure: 'unavailable' });
    expect(withOutcome(submitting(), { kind: 'network' }).status).toBe('networkError');
  });
});

describe('idempotency-key policy (the P4.2 bug)', () => {
  const retryKey = (outcome: Outcome) => {
    const failed = withOutcome(submitting('first-key'), outcome);
    return submitWith(failed, 'second-key').pending?.key;
  };

  it.each([
    ['network error', { kind: 'network' } as Outcome],
    ['5xx', { kind: 'unavailable' } as Outcome],
    ['429', { kind: 'rate_limited' } as Outcome],
  ])('REUSES the key for an exact retry after a %s', (_label, outcome) => {
    expect(retryKey(outcome)).toBe('first-key');
  });

  it('uses a NEW key after a 409 even if the payload is unchanged', () => {
    expect(retryKey({ kind: 'email_taken' })).toBe('second-key');
  });

  it('uses a NEW key after a mappable 422', () => {
    expect(retryKey({ kind: 'validation', fields: { email: ['bad'] } })).toBe('second-key');
  });

  it('uses a NEW key after an unmappable 422', () => {
    expect(retryKey({ kind: 'validation', fields: { _form: ['bad'] } })).toBe('second-key');
  });

  it('uses a NEW key when the payload changed after a retryable failure (edit email, resubmit)', () => {
    const failed = withOutcome(submitting('first-key', 'ada@example.com'), { kind: 'network' });
    const edited = reduce(failed, { type: 'edit', field: 'email', value: 'grace@example.com' });
    expect(submitWith(edited, 'second-key').pending?.key).toBe('second-key');
  });

  it('REUSES the key when the user edits and then restores the identical payload', () => {
    const failed = withOutcome(submitting('first-key', 'ada@example.com'), { kind: 'network' });
    const edited = run(failed, { type: 'edit', field: 'email', value: 'grace@example.com' }, { type: 'edit', field: 'email', value: 'ADA@example.com ' });
    expect(submitWith(edited, 'second-key').pending?.key).toBe('first-key');
  });

  it('a key is never reused across a success (fresh machine state has no pending)', () => {
    expect(submitWith(run(initialState, ...fill('a@b.co')), 'only-key').pending?.key).toBe('only-key');
  });
});

describe('announcements and retry affordance', () => {
  it('announces submitting / success / network / server errors, and nothing in idle', () => {
    expect(announcement(initialState)).toBe('');
    expect(announcement(submitting())).toBe(MESSAGES.submitting);
    expect(announcement(withOutcome(submitting(), { kind: 'created' }))).toBe(MESSAGES.success);
    expect(announcement(withOutcome(submitting(), { kind: 'network' }))).toBe(MESSAGES.network);
    expect(announcement(withOutcome(submitting(), { kind: 'unavailable' }))).toBe(MESSAGES.unavailable);
    expect(announcement(withOutcome(submitting(), { kind: 'rate_limited' }))).toBe(MESSAGES.rateLimited);
    expect(announcement(withOutcome(submitting(), { kind: 'email_taken' }))).toBe(MESSAGES.emailTaken);
  });

  it('announces the number of invalid fields', () => {
    expect(announcement(submitWith(run(initialState, ...fill('nope')), 'k'))).toBe('1 field needs attention.');
    expect(announcement(submitWith(run(initialState, ...fill('nope', 'x'.repeat(81))), 'k'))).toBe('2 fields need attention.');
  });

  it('only retryable failures offer "Try again"', () => {
    expect(isRetryable(withOutcome(submitting(), { kind: 'network' }))).toBe(true);
    expect(isRetryable(withOutcome(submitting(), { kind: 'unavailable' }))).toBe(true);
    expect(isRetryable(withOutcome(submitting(), { kind: 'rate_limited' }))).toBe(true);
    expect(isRetryable(withOutcome(submitting(), { kind: 'email_taken' }))).toBe(false);
    expect(isRetryable(initialState)).toBe(false);
  });
});
