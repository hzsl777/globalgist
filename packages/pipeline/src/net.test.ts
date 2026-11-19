import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress, readCapped, safeFetch, UnsafeFetchError } from "./net.js";

const publicHost = async () => ["93.184.216.34"];
const body = (text: string, init: ResponseInit = {}) => new Response(text, { status: 200, ...init });

describe("isPrivateAddress", () => {
  it("refuses the addresses a runner must never fetch", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:a00:1", "ff02::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("refuses other schemes, credentials and hosts that resolve to a private address", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicHost)).rejects.toThrow(UnsafeFetchError);
    await expect(assertPublicUrl("ftp://outlet.example/feed", publicHost)).rejects.toThrow(/not fetched/);
    await expect(assertPublicUrl("https://user:pw@outlet.example/", publicHost)).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/", publicHost)).rejects.toThrow(/not a public address/);
    await expect(assertPublicUrl("http://[::1]:8080/", publicHost)).rejects.toThrow(/not a public address/);
    await expect(assertPublicUrl("https://outlet.example/", async () => ["93.184.216.34", "10.0.0.5"])).rejects.toThrow(/not a public address/);
    await expect(assertPublicUrl("https://outlet.example/", async () => [])).rejects.toThrow(/not a public address/);
  });
  it("accepts a public http or https address", async () => {
    expect((await assertPublicUrl("https://outlet.example/feed?x=1", publicHost)).hostname).toBe("outlet.example");
    expect((await assertPublicUrl("http://outlet.example/", publicHost)).protocol).toBe("http:");
  });
});

describe("readCapped", () => {
  it("reads a body within the limit", async () => {
    expect(new TextDecoder().decode(await readCapped(body("hello"), 10))).toBe("hello");
  });
  it("stops at the limit, and refuses a declared length over it without reading", async () => {
    await expect(readCapped(body("x".repeat(50)), 10)).rejects.toThrow(/over the 10 byte limit/);
    await expect(readCapped(body("x", { headers: { "content-length": "999" } }), 10)).rejects.toThrow(/999 bytes/);
  });
});

describe("safeFetch", () => {
  it("follows a redirect to another public address", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: URL) => {
      calls.push(String(u));
      return calls.length === 1 ? new Response(null, { status: 301, headers: { location: "https://other.example/feed" } }) : body("<rss/>");
    }) as unknown as typeof fetch;
    const out = await safeFetch("https://outlet.example/feed", {}, 1000, { fetchImpl, resolve: publicHost });
    expect(new TextDecoder().decode(out.body)).toBe("<rss/>");
    expect(calls).toEqual(["https://outlet.example/feed", "https://other.example/feed"]);
  });
  it("refuses a redirect into the runner's own network, and never fetches it", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (u: URL) => {
      calls.push(String(u));
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as unknown as typeof fetch;
    await expect(safeFetch("https://outlet.example/a", {}, 1000, { fetchImpl, resolve: publicHost })).rejects.toThrow(/not a public address/);
    expect(calls).toEqual(["https://outlet.example/a"]);
  });
  it("stops a redirect loop, and a body past the limit", async () => {
    const loop = (async () => new Response(null, { status: 302, headers: { location: "https://outlet.example/again" } })) as unknown as typeof fetch;
    await expect(safeFetch("https://outlet.example/a", {}, 1000, { fetchImpl: loop, resolve: publicHost })).rejects.toThrow(/redirects/);
    const big = (async () => body("x".repeat(5000))) as unknown as typeof fetch;
    await expect(safeFetch("https://outlet.example/a", {}, 1000, { fetchImpl: big, resolve: publicHost })).rejects.toThrow(/byte limit/);
  });
  it("returns an error response without reading its body", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const out = await safeFetch("https://outlet.example/a", {}, 1000, { fetchImpl, resolve: publicHost });
    expect(out.res.status).toBe(503);
    expect(out.body.byteLength).toBe(0);
  });
});
