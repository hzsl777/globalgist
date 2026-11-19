// Outbound fetches of third-party pages (decision 165). An outlet's feed lists the article addresses, so a hostile or
// compromised outlet chooses what the runner fetches. Every fetch here refuses anything but http and https, refuses an
// address that is not a public one (the runner's own network, the cloud metadata address, loopback), checks every
// redirect the same way, and stops reading a response past a size limit.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** A feed, and an article page, larger than these are not an outlet's feed or article. */
export const MAX_FEED_BYTES = 10 * 1024 * 1024;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** A fetch refused before or while it ran: the address is not public, the scheme is not http, or the body is too big. */
export class UnsafeFetchError extends Error {}

/** True for an address no public outlet is at: private, loopback, link-local (the cloud metadata address), shared, reserved or multicast. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    // An IPv4 address written inside an IPv6 one is judged as the IPv4 address; any other mapped form is refused.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (s.startsWith("::ffff:")) return true;
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true;
}

/** Every address a host name resolves to. */
export type Resolver = (host: string) => Promise<string[]>;
const resolveAll: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** The URL, if it is http or https with no credentials and every address its host resolves to is public. */
export async function assertPublicUrl(raw: string | URL, resolve: Resolver = resolveAll): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UnsafeFetchError(`${u.protocol} addresses are not fetched`);
  if (u.username || u.password) throw new UnsafeFetchError("addresses with credentials are not fetched");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new UnsafeFetchError(`${host} is not a public address`);
  return u;
}

/** The response body, read in full only up to `max` bytes; past that the read stops and the fetch fails. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await res.body?.cancel();
    throw new UnsafeFetchError(`the response says it is ${declared} bytes, over the ${max} byte limit`);
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new UnsafeFetchError(`the response is over the ${max} byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * One fetch with the checks above. Redirects are followed by hand, so each hop is checked. The body is read only for
 * a successful response.
 */
export async function safeFetch(
  url: string,
  init: RequestInit,
  maxBytes: number,
  deps: { fetchImpl?: typeof fetch; resolve?: Resolver } = {},
): Promise<{ res: Response; body: Uint8Array }> {
  const doFetch = deps.fetchImpl ?? fetch;
  let current: string | URL = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current, deps.resolve);
    const res = await doFetch(u, { ...init, redirect: "manual" });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (next) {
      await res.body?.cancel();
      current = new URL(next, u);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { res, body: new Uint8Array() };
    }
    return { res, body: await readCapped(res, maxBytes) };
  }
  throw new UnsafeFetchError(`more than ${MAX_REDIRECTS} redirects`);
}
