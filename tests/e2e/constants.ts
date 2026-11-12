export const PORT = 4401;
// `localhost`, not 127.0.0.1: Astro's origin check compares Origin with the URL it derives, and matched only for localhost here.
export const ORIGIN = `http://localhost:${PORT}`;

/** Local capture sink standing in for PostHog: records what the browser AND the server send (tests/e2e/sink.mjs). */
export const SINK_PORT = 4410;
export const SINK_ORIGIN = `http://localhost:${SINK_PORT}`;
