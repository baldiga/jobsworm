import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * CONTACT is read once at import, so each case sets the environment first and
 * then imports a fresh copy of the module — the same pattern as site.test.ts.
 */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value as string);
  }
  return (await import("./contact")).CONTACT;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const ALL = [
  "NEXT_PUBLIC_CONTACT_WHATSAPP",
  "NEXT_PUBLIC_CONTACT_EMAIL",
  "NEXT_PUBLIC_OWNER_NAME",
  "NEXT_PUBLIC_OWNER_URL",
  "NEXT_PUBLIC_GA_ID",
];

describe("CONTACT", () => {
  /*
   * The case a fresh fork is in. Every consumer hides its feature on null, so
   * this is what keeps a fork from rendering a dead WhatsApp link or loading
   * analytics for an account it does not own.
   */
  it("is entirely null when nothing is configured", async () => {
    const contact = await load(Object.fromEntries(ALL.map((k) => [k, undefined])));
    expect(Object.values(contact).every((v) => v === null)).toBe(true);
  });

  it("treats a blank or whitespace value as unset", async () => {
    const contact = await load(Object.fromEntries(ALL.map((k) => [k, "   "])));
    expect(Object.values(contact).every((v) => v === null)).toBe(true);
  });

  /*
   * People paste numbers the way they write them. wa.me wants digits only and
   * no plus; anything else opens WhatsApp on an error page.
   */
  it("reduces a WhatsApp number to digits", async () => {
    const contact = await load({ NEXT_PUBLIC_CONTACT_WHATSAPP: "+972 50-123-4567" });
    expect(contact.whatsappUrl).toBe("https://wa.me/972501234567");
  });

  it("treats a WhatsApp value with no digits as unset", async () => {
    const contact = await load({ NEXT_PUBLIC_CONTACT_WHATSAPP: "n/a" });
    expect(contact.whatsappUrl).toBeNull();
  });

  it("trims the other values", async () => {
    const contact = await load({
      NEXT_PUBLIC_CONTACT_EMAIL: " hello@example.com ",
      NEXT_PUBLIC_OWNER_NAME: " Ada Lovelace ",
      NEXT_PUBLIC_GA_ID: " G-TEST123 ",
    });
    expect(contact.email).toBe("hello@example.com");
    expect(contact.ownerName).toBe("Ada Lovelace");
    expect(contact.gaId).toBe("G-TEST123");
  });
});
