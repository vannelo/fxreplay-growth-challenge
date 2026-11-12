/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** First-party random visitor id (ADR-007). Set by src/middleware.ts for page requests. */
    visitorId: string;
    /** Sticky experiment arm (ADR-004). */
    variant: import('./lib/experiment').Variant;
  }
}
