/**
 * Type-level gate: this file is compiled by `astro check`. Every `@ts-expect-error` below MUST be an error; if the
 * registry ever loosens, the directive becomes "unused" and the check fails. The runtime part just keeps vitest happy.
 */
import { describe, expect, it } from 'vitest';
import { createTracker } from '../../src/analytics/client';
import type { EventMap } from '../../src/analytics/events';
import { noopAnalytics } from '../../src/analytics/server';

const tracker = createTracker({
  key: undefined,
  host: 'http://x',
  env: 'test',
  cookies: () => '',
  transport: () => {},
  schedule: () => {},
  consent: () => true,
});

describe('track() is typed by the registry (compile-time; see directives)', () => {
  it('accepts exactly the plan’s events with their properties', () => {
    tracker.track('landing_viewed', { device_class: 'mobile', utm_source: 'google' });
    tracker.track('signup_started', { fields_shown: ['email'] });
    tracker.track('signup_submitted', { attempt: 1, name_provided: false });
    tracker.track('signup_failed', { source: 'network', error_code: 'network_error', retryable: true });
    noopAnalytics.capture({ name: 'signup_succeeded', props: { user_id: 'u', name_provided: true } }, new Request('http://x'));
    expect(true).toBe(true);
  });

  it('rejects everything else at compile time', () => {
    const never = () => {
      // @ts-expect-error unknown event name
      tracker.track('nonexistent', {});
      // @ts-expect-error missing required property (device_class)
      tracker.track('landing_viewed', {});
      // @ts-expect-error property that is not in the registry
      tracker.track('landing_viewed', { device_class: 'mobile', email: 'a@b.co' });
      // @ts-expect-error wrong type for a registry property
      tracker.track('signup_submitted', { attempt: '1', name_provided: false });
      // @ts-expect-error value outside the enum
      tracker.track('signup_failed', { source: 'somewhere', error_code: 'network_error', retryable: true });
      // @ts-expect-error the browser cannot emit the conversion event
      tracker.track('signup_succeeded', { user_id: 'u', name_provided: true });
      // @ts-expect-error the server port cannot emit client-only events
      noopAnalytics.capture({ name: 'landing_viewed', props: { device_class: 'mobile' } }, new Request('http://x'));
    };
    expect(typeof never).toBe('function');
  });

  it('EventMap is the single source of property names', () => {
    const props: EventMap['signup_started'] = { fields_shown: ['email', 'name'] };
    expect(props.fields_shown).toHaveLength(2);
  });
});
