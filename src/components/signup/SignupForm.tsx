import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { Variant } from '../../lib/experiment';
import { createUser, readVisitorId } from './signup-client';
import { MESSAGES, announcement, initialState, isRetryable, reduce, type FieldName } from './signup-machine';

interface Props {
  variant: Variant;
  /** Where "Sign in" points on a 409. Unset until the owner supplies it. */
  signinUrl?: string | undefined;
}

const inputClass = (invalid: boolean) =>
  `mt-1.5 block w-full rounded-lg border bg-bg-secondary px-4 py-3 text-base text-text-primary placeholder:text-text-secondary/60 ${
    invalid ? 'border-field-border-error' : 'border-field-border'
  }`;

export default function SignupForm({ variant, signinUrl }: Props) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [ready, setReady] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const busy = state.status === 'submitting' || state.status === 'validating';
  const retry = isRetryable(state);

  useEffect(() => {
    // Anything typed or autofilled before the island hydrated lives only in the DOM: adopt it into state.
    // (The inputs are uncontrolled on purpose: a controlled `value=""` would wipe pre-hydration typing.)
    for (const [field, input] of [['email', emailRef.current], ['name', nameRef.current]] as const) {
      if (input?.value) dispatch({ type: 'edit', field, value: input.value });
    }
    performance.mark('signup-hydrated'); // TEMP(G2): removed once the hydration directive is chosen from measurements
    setReady(true);
  }, []);

  // Send the request when the machine enters `submitting`. The machine decided the key; this only performs I/O.
  useEffect(() => {
    if (state.status !== 'submitting' || !state.pending) return;
    let active = true;
    void createUser(state.pending.payload, state.pending.key, readVisitorId()).then((outcome) => {
      if (active) dispatch({ type: 'outcome', outcome });
    });
    return () => {
      active = false;
    };
  }, [state.status, state.pending]);

  // Focus management: first invalid field on failure; the confirmation heading on success.
  useEffect(() => {
    if (state.status === 'fieldError' || state.failure === 'email_taken') {
      (state.errors.email ? emailRef : nameRef).current?.focus();
    } else if (state.status === 'success') {
      successRef.current?.focus();
    }
  }, [state.status, state.failure, state.attempt]); // `attempt`: a repeat of the SAME failure must move focus again

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (!ready || busy) return;
    dispatch({ type: 'submit' });
    // Validation is synchronous: both dispatches land in one render, so `validating` is never painted.
    dispatch({ type: 'validated', newKey: crypto.randomUUID() });
  };

  const onInput = (field: FieldName) => (event: Event) =>
    dispatch({ type: 'edit', field, value: (event.currentTarget as HTMLInputElement).value });

  const errorFor = (field: FieldName) => state.errors[field];
  const describedBy = (field: FieldName) => (errorFor(field) ? `signup-${field}-error` : undefined);

  const message =
    state.status === 'networkError'
      ? MESSAGES.network
      : state.status === 'serverError' && state.failure !== 'email_taken'
        ? announcement(state)
        : null;

  return (
    <div id="signup" class="scroll-mt-24">
      {/* Always rendered so assistive tech registers the region before the first update. */}
      <div role="status" aria-live="polite" class="sr-only">
        {/* Keyed by attempt: identical text is still a DOM change, so assistive tech announces it again. */}
        <span key={state.attempt}>{announcement(state)}</span>
      </div>

      {state.status === 'success' ? (
        <div class="rounded-2xl border border-border-success bg-card p-6 sm:p-8">
          <h2 ref={successRef} tabIndex={-1} class="font-display text-2xl font-bold text-text-primary">
            Account created
          </h2>
          <p class="mt-2 text-text-secondary">
            Your free FX Replay account is ready.{' '}
            {signinUrl ? (
              <>
                <a href={signinUrl} class="font-semibold text-text-link underline">
                  Sign in
                </a>{' '}
                to start your first replay.
              </>
            ) : (
              'Sign in to start your first replay.'
            )}
          </p>
        </div>
      ) : (
        <form
          noValidate
          aria-label="Create your free account"
          onSubmit={onSubmit}
          class="rounded-2xl border border-border-secondary bg-card p-6 sm:p-8"
        >
          <div>
            <label for="signup-email" class="block text-sm font-semibold text-text-primary">
              Email
            </label>
            <input
              ref={emailRef}
              id="signup-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellcheck={false}
              required
              readOnly={busy}
              onInput={onInput('email')}
              aria-invalid={errorFor('email') ? true : undefined}
              aria-describedby={describedBy('email')}
              class={inputClass(!!errorFor('email'))}
            />
            {errorFor('email') && (
              <p id="signup-email-error" class="mt-2 text-sm text-text-error">
                {errorFor('email')}
                {state.failure === 'email_taken' && (
                  <>
                    {' '}
                    {signinUrl ? (
                      <a href={signinUrl} class="font-semibold text-text-link underline">
                        Sign in
                      </a>
                    ) : (
                      <span class="font-semibold">Sign in</span> // no PUBLIC_SIGNIN_URL set: plain text, never a fake link
                    )}
                  </>
                )}
              </p>
            )}
          </div>

          {variant === 'control' && (
            <div class="mt-5">
              <label for="signup-name" class="block text-sm font-semibold text-text-primary">
                Name <span class="font-normal text-text-secondary">(optional)</span>
              </label>
              <input
                ref={nameRef}
                id="signup-name"
                name="name"
                type="text"
                autoComplete="name"
                readOnly={busy}
                onInput={onInput('name')}
                aria-invalid={errorFor('name') ? true : undefined}
                aria-describedby={describedBy('name')}
                class={inputClass(!!errorFor('name'))}
              />
              {errorFor('name') && (
                <p id="signup-name-error" class="mt-2 text-sm text-text-error">
                  {errorFor('name')}
                </p>
              )}
            </div>
          )}

          {message && <p class="mt-5 text-sm text-text-error">{message}</p>}

          <button
            type="submit"
            // Disabled until hydrated so a click before the island is live cannot trigger a native form submit.
            disabled={!ready}
            // aria-disabled (not disabled) while busy: the button keeps focus, so keyboard and screen-reader users aren't dropped.
            aria-disabled={busy ? true : undefined}
            class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-btn-primary px-5 py-3.5 text-base font-bold text-btn-text hover:bg-btn-primary-hover active:bg-btn-primary-pressed disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-progress"
          >
            {busy && (
              <span
                aria-hidden="true"
                class="size-4 animate-spin rounded-full border-2 border-btn-text border-t-transparent motion-reduce:animate-none"
              />
            )}
            {busy ? 'Creating account…' : retry ? 'Try again' : 'Try FX Replay Free'}
          </button>
        </form>
      )}
    </div>
  );
}
