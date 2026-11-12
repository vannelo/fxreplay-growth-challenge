/** Read one cookie from a `document.cookie`-style string. Pure, so it is testable without a DOM. */
export function readCookie(name: string, cookie: string): string | undefined {
  return cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
