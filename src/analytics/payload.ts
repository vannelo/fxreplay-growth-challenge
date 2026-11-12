import type { Variant } from '../lib/experiment';
import { EXPERIMENT } from '../lib/experiment';
import type { AppEnv, EventMap, EventName } from './events';

export interface EventContext {
  distinctId: string;
  variant: Variant | 'unattributed';
  env: AppEnv;
}

export interface CaptureEvent {
  event: EventName;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/**
 * PostHog capture body for one event. Context fields are written AFTER the event's own properties so an event can never
 * override them. `$process_person_profile: false` keeps visitors anonymous (no person profiles; ADR-007).
 */
export function buildEvent<K extends EventName>(
  name: K,
  props: EventMap[K],
  context: EventContext,
  lib: 'fxr-web' | 'fxr-server',
  timestamp: Date,
  insertId?: string,
): CaptureEvent {
  return {
    event: name,
    distinct_id: context.distinctId,
    timestamp: timestamp.toISOString(),
    properties: {
      ...props,
      experiment: EXPERIMENT,
      variant: context.variant,
      env: context.env,
      $lib: lib,
      $process_person_profile: false,
      ...(insertId ? { $insert_id: insertId } : {}),
    },
  };
}

/** Consent gate (ADR-007): Global Privacy Control is the "denied" signal. One function so a CMP can replace it later. */
export const gpcOptedOut = (value: unknown) => value === true || value === '1' || value === 1;
