/**
 * Signup form state machine (P4.2). Pure: no I/O, no randomness (the caller supplies the idempotency key).
 * Idempotency-key rule: a key is reused ONLY for an exact retry of the same payload after a retryable failure
 * (network error, 5xx, 429). A changed payload or any definitive 4xx gets a fresh key: reusing a key with a
 * different body is a 422 `idempotency_key_reuse` from the server.
 */
import { CreateUserBody, fieldErrorsFrom } from '../../contracts/users';

export type FieldName = 'email' | 'name';
export interface Values {
  email: string;
  name: string;
}
export type FieldErrors = Partial<Record<FieldName, string>>;
export type Payload = CreateUserBody;

export type Status =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'success'
  | 'fieldError'
  | 'serverError'
  | 'networkError';
export type Failure = 'email_taken' | 'rate_limited' | 'unavailable';

interface Pending {
  key: string;
  payload: Payload;
  /** true only after a retryable failure: the next submit of the identical payload reuses `key`. */
  reusable: boolean;
}

export interface SignupState {
  status: Status;
  values: Values;
  errors: FieldErrors;
  failure: Failure | null;
  retryAfter: number | null;
  pending: Pending | null;
  /** Counts validated submit attempts, so the UI can react to a repeat of the SAME failure (focus + re-announce). */
  attempt: number;
}

export type Outcome =
  | { kind: 'created' }
  | { kind: 'email_taken' }
  | { kind: 'validation'; fields: Record<string, string[]> }
  | { kind: 'rate_limited'; retryAfter?: number }
  | { kind: 'unavailable' }
  | { kind: 'network' };

export type Action =
  | { type: 'edit'; field: FieldName; value: string }
  | { type: 'submit' }
  | { type: 'validated'; newKey: string }
  | { type: 'outcome'; outcome: Outcome };

export const initialState: SignupState = {
  status: 'idle',
  values: { email: '', name: '' },
  errors: {},
  failure: null,
  retryAfter: null,
  pending: null,
  attempt: 0,
};

export const MESSAGES = {
  emailTaken: 'This email already has an account. Sign in instead, or use a different email.',
  rateLimited: 'Too many attempts. Please wait a moment and try again.',
  unavailable: 'Something went wrong on our side. Please try again.',
  network: 'Connection problem. Check your connection and try again.',
  submitting: 'Creating your account…',
  success: 'Account created.',
} as const;

const FIELDS: readonly FieldName[] = ['email', 'name'];
const isField = (key: string): key is FieldName => (FIELDS as readonly string[]).includes(key);

const toInput = (values: Values) => ({
  email: values.email,
  ...(values.name.trim() === '' ? {} : { name: values.name }),
});

const samePayload = (a: Payload, b: Payload) => a.email === b.email && (a.name ?? null) === (b.name ?? null);

/** First message per known field; anything else (e.g. `_form`, headers) is not user-fixable here. */
function pickFieldErrors(fields: Record<string, string[]>): FieldErrors {
  const errors: FieldErrors = {};
  for (const [key, messages] of Object.entries(fields)) {
    if (isField(key) && messages[0]) errors[key] = messages[0];
  }
  return errors;
}

export function reduce(state: SignupState, action: Action): SignupState {
  switch (action.type) {
    case 'edit': {
      if (state.status === 'validating' || state.status === 'submitting' || state.status === 'success') return state;
      const { [action.field]: _cleared, ...errors } = state.errors;
      return {
        ...state,
        status: 'idle',
        values: { ...state.values, [action.field]: action.value },
        errors,
        failure: null,
        retryAfter: null,
      };
    }

    case 'submit':
      // The only way into `validating`; ignored while a request is in flight (double-submit guard) or after success.
      if (state.status === 'validating' || state.status === 'submitting' || state.status === 'success') return state;
      return { ...state, status: 'validating', failure: null, retryAfter: null };

    case 'validated': {
      if (state.status !== 'validating') return state;
      const parsed = CreateUserBody.safeParse(toInput(state.values));
      if (!parsed.success) {
        return { ...state, attempt: state.attempt + 1, status: 'fieldError', errors: pickFieldErrors(fieldErrorsFrom(parsed.error)) };
      }
      const payload = parsed.data;
      const reuse = state.pending?.reusable === true && samePayload(state.pending.payload, payload);
      return {
        ...state,
        attempt: state.attempt + 1,
        status: 'submitting',
        errors: {},
        pending: { key: reuse ? state.pending!.key : action.newKey, payload, reusable: false },
      };
    }

    case 'outcome': {
      if (state.status !== 'submitting' || !state.pending) return state;
      const { pending } = state;
      const { outcome } = action;
      switch (outcome.kind) {
        case 'created':
          return { ...state, status: 'success', pending: null };
        case 'email_taken':
          return { ...state, status: 'serverError', failure: 'email_taken', errors: { email: MESSAGES.emailTaken } };
        case 'validation': {
          const errors = pickFieldErrors(outcome.fields);
          if (Object.keys(errors).length > 0) return { ...state, status: 'fieldError', errors };
          // A 422 we cannot map to a field is a client/contract bug: say so generically, and use a fresh key next time.
          return { ...state, status: 'serverError', failure: 'unavailable' };
        }
        case 'rate_limited':
          return {
            ...state,
            status: 'serverError',
            failure: 'rate_limited',
            retryAfter: outcome.retryAfter ?? null,
            pending: { ...pending, reusable: true },
          };
        case 'unavailable':
          return { ...state, status: 'serverError', failure: 'unavailable', pending: { ...pending, reusable: true } };
        case 'network':
          return { ...state, status: 'networkError', pending: { ...pending, reusable: true } };
      }
    }
  }
}

/** True when the primary button should read "Try again" and resubmit the same payload. */
export const isRetryable = (state: SignupState) =>
  state.status === 'networkError' || (state.status === 'serverError' && state.failure !== 'email_taken');

/** What the polite live region announces. Empty string = say nothing. */
export function announcement(state: SignupState): string {
  switch (state.status) {
    case 'submitting':
      return MESSAGES.submitting;
    case 'success':
      return MESSAGES.success;
    case 'networkError':
      return MESSAGES.network;
    case 'fieldError': {
      const count = Object.keys(state.errors).length;
      return count === 1 ? '1 field needs attention.' : `${count} fields need attention.`;
    }
    case 'serverError':
      return state.failure === 'email_taken'
        ? MESSAGES.emailTaken
        : state.failure === 'rate_limited'
          ? rateLimitedMessage(state.retryAfter)
          : MESSAGES.unavailable;
    default:
      return '';
  }
}

export const rateLimitedMessage = (retryAfter: number | null) =>
  retryAfter ? `Too many attempts. Please wait ${retryAfter} seconds and try again.` : MESSAGES.rateLimited;
