import { describe, expect, it } from "vitest";
import { allowlistAdmits, parseAllowlist } from "./allowlist";

describe("allowlistAdmits", () => {
  it("admits an address on the list", () => {
    expect(allowlistAdmits("office@example.com", "office@example.com")).toBe(true);
  });

  it("admits NOBODY when the list is empty or unset", () => {
    /*
     * The single most important case here. An unset variable is a
     * misconfigured deploy, and a misconfigured deploy must hide the thing it
     * guards rather than hand it to everyone. An allowlist that matches all
     * when empty is a lock that opens when you forget the key.
     */
    for (const raw of ["", "   ", ",,", undefined, null]) {
      expect(allowlistAdmits(raw, "office@example.com")).toBe(false);
    }
  });

  it("refuses an address that is not on the list", () => {
    expect(allowlistAdmits("office@example.com", "someone@else.com")).toBe(false);
  });

  it("refuses a missing email even when the list is populated", () => {
    expect(allowlistAdmits("office@example.com", null)).toBe(false);
    expect(allowlistAdmits("office@example.com", "")).toBe(false);
    expect(allowlistAdmits("office@example.com", undefined)).toBe(false);
  });

  it("ignores casing and whitespace on both sides", () => {
    // A gate that fails on "Office@..." would lock out the very person it was
    // written for, and they would reasonably conclude the site was broken.
    expect(allowlistAdmits(" Office@Example.com ", "office@example.com")).toBe(true);
    expect(allowlistAdmits("office@example.com", "  OFFICE@EXAMPLE.COM  ")).toBe(true);
  });

  it("handles several addresses", () => {
    const list = "office@example.com, owner@example.com";
    expect(allowlistAdmits(list, "owner@example.com")).toBe(true);
    expect(allowlistAdmits(list, "office@example.com")).toBe(true);
    expect(allowlistAdmits(list, "third@example.com")).toBe(false);
  });

  it("does not match a substring or a lookalike domain", () => {
    expect(allowlistAdmits("office@example.com", "office@example.com.evil.net")).toBe(false);
    expect(allowlistAdmits("office@example.com", "notoffice@example.com")).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("drops empties and normalises", () => {
    expect(parseAllowlist(" A@b.com ,, C@d.com,")).toEqual(["a@b.com", "c@d.com"]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});
