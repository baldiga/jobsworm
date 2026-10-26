import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * SITE_URL is read once at import, so each case sets the environment first and
 * then imports a fresh copy of the module.
 */
async function load(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined as unknown as string);
  else vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
  return (await import("./site")).SITE_URL;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SITE_URL", () => {
  /*
   * Production does not set the env var, so this default IS the live value:
   * it becomes metadataBase, every sitemap <loc>, and the robots.txt Sitemap
   * line. It must be the address that serves the site, not one that redirects
   * to it — jobswarm.fun and the bare jobsworm.fun both 308 here.
   */
  it("defaults to the canonical host, with www", async () => {
    expect(await load(undefined)).toBe("https://www.jobsworm.fun");
  });

  it("never falls back to a retired or preview domain", async () => {
    const url = await load(undefined);
    expect(url).not.toMatch(/jobswarm|vercel\.app|localhost/);
  });

  /*
   * A blank value in the Vercel dashboard is an empty string, not an absent
   * one. With `??` it passed straight through, and `new URL("")` in the root
   * layout throws — every page down over one empty field.
   */
  it("treats a blank or whitespace value as unset", async () => {
    expect(await load("")).toBe("https://www.jobsworm.fun");
    expect(await load("   ")).toBe("https://www.jobsworm.fun");
  });

  it("lets the environment override it, for previews and local runs", async () => {
    expect(await load("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("strips a trailing slash so `${SITE_URL}/jobs` cannot become //jobs", async () => {
    expect(await load("https://preview.example.dev/")).toBe("https://preview.example.dev");
  });
});
