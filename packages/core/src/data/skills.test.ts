import { describe, expect, it } from "vitest";
import { SKILLS, AMBIGUOUS, SKILL_INDEX } from "./skills";
import { BUSINESS_SKILLS, BUSINESS_AMBIGUOUS } from "./business-skills";
import { extractSkills } from "../decompose";

/**
 * Guards on the skill dictionaries themselves.
 *
 * The dictionaries are the input to every classification the site makes, and a
 * bad entry does not fail anything — it quietly mislabels rows. `lifecycle`
 * was added as an alias once and turned every posting containing the ordinary
 * English word into a row claiming a technology. Nothing caught it, because
 * nothing was checking the dictionary; it was found by reading output.
 *
 * These tests check the dictionary rather than the classifier, so the next one
 * fails at commit time.
 */

/**
 * Ordinary English words that also appear, or could plausibly appear, as a
 * single-word alias.
 *
 * Not a general English word list — a list of the words that actually cause
 * this failure, which is a much smaller and more useful set: business verbs,
 * process nouns and adjectives that turn up in every job description ever
 * written. A word here is only allowed as an alias if it is marked ambiguous,
 * which forces `ambiguousAccepted` to find supporting context before counting
 * it as a skill.
 */
const COMMON_ENGLISH = new Set([
  "access", "account", "action", "active", "add", "agile", "alert", "analysis",
  "analytics", "api", "app", "apply", "approach", "area", "asset", "audit",
  "base", "basic", "board", "brand", "budget", "build", "business", "campaign",
  "capacity", "case", "cause", "change", "channel", "chart", "check", "client",
  "close", "cloud", "code", "collection", "commerce", "company", "compliance",
  "component", "concept", "content", "context", "control", "core", "cost",
  "coverage", "culture", "customer", "cycle", "data", "delivery", "demand",
  "design", "development", "device", "discovery", "display", "document",
  "domain", "drive", "engagement", "engine", "enterprise", "environment",
  "event", "execution", "experience", "expert", "feature", "feedback", "field",
  "file", "flow", "focus", "forecast", "form", "foundation", "framework",
  "function", "funnel", "goal", "governance", "group", "growth", "guide",
  "health", "impact", "implementation", "improvement", "index", "industry",
  "initiative", "insight", "integration", "intelligence", "interface",
  "inventory", "issue", "journey", "keyword", "knowledge", "launch", "layer",
  "lead", "learning", "level", "leverage", "library", "lifecycle", "link",
  "list", "log", "loop", "management", "market", "marketing", "match",
  "material", "measure", "media", "meeting", "memory", "message", "method",
  "metric", "model", "module", "monitor", "network", "note", "object",
  "operation", "opportunity", "option", "order", "outcome", "output", "page",
  "partner", "pattern", "performance", "pipeline", "plan", "platform", "plus",
  "policy", "portfolio", "position", "practice", "presentation", "price",
  "priority", "process", "product", "profile", "program", "project",
  "quality", "query", "range", "rate", "record", "region", "release",
  "report", "request", "requirement", "research", "resource", "response",
  "result", "revenue", "review", "risk", "roadmap", "role", "route", "sale",
  "scale", "schedule", "scope", "script", "search", "security", "segment",
  "service", "session", "share", "signal", "solution", "source", "space",
  "spec", "speed", "stack", "stage", "standard", "state", "status", "step",
  "storage", "store", "strategy", "stream", "structure", "style", "success",
  "support", "survey", "system", "table", "target", "task", "team",
  "technology", "test", "testing", "time", "tool", "topic", "track",
  "traffic", "training", "transaction", "transfer", "trend", "type", "unit",
  "update", "usage", "user", "value", "version", "view", "vision", "volume",
  "web", "work", "workflow",
]);

type Entry = { term: string; aliases: string[] };

function offenders(entries: readonly Entry[], ambiguous: ReadonlySet<string>): string[] {
  const bad: string[] = [];
  for (const s of entries) {
    for (const alias of [s.term, ...s.aliases]) {
      const a = alias.toLowerCase().trim();
      // Single Latin word only. Multi-word aliases and Hebrew ones cannot be
      // mistaken for an ordinary English word in this way.
      if (!/^[a-z][a-z-]{2,}$/.test(a)) continue;
      if (!COMMON_ENGLISH.has(a)) continue;
      if (ambiguous.has(a) || ambiguous.has(s.term.toLowerCase())) continue;
      bad.push(`${a} (from "${s.term}")`);
    }
  }
  return bad.sort();
}

describe("the skill dictionary", () => {
  it("marks every ordinary English word as ambiguous", () => {
    // If this fails, the listed alias will match the plain English word in any
    // job description. Either mark it ambiguous, or remove it.
    expect(offenders(SKILLS as readonly Entry[], AMBIGUOUS)).toEqual([]);
  });

  it("marks every ordinary English word in the business dictionary as ambiguous", () => {
    expect(offenders(BUSINESS_SKILLS as readonly Entry[], BUSINESS_AMBIGUOUS)).toEqual([]);
  });

  it("has no duplicate canonical terms WITHIN a dictionary", () => {
    // Within one list a repeat is simply an error: two entries for the same
    // term, only one of which is ever reached.
    for (const [name, list] of [
      ["skills", SKILLS],
      ["business-skills", BUSINESS_SKILLS],
    ] as const) {
      const terms = list.map((s) => s.term.toLowerCase());
      const dupes = [...new Set(terms.filter((t, i) => terms.indexOf(t) !== i))];
      expect(dupes, `duplicate terms in ${name}`).toEqual([]);
    }
  });

  it("marks a term that appears in BOTH dictionaries consistently", () => {
    /*
     * About two dozen terms are deliberately in both — salesforce and hubspot
     * are a CRM to a salesperson and an integration target to an engineer.
     * That is fine. What is not fine is the two entries disagreeing about
     * ambiguity: `ALIAS_ROWS` dedupes by alias and the SKILLS entry wins, so a
     * term marked ambiguous only on the business side would silently lose that
     * marking and start matching prose.
     */
    const businessTerms = new Map(BUSINESS_SKILLS.map((s) => [s.term.toLowerCase(), s]));
    const inconsistent: string[] = [];
    for (const s of SKILLS) {
      const term = s.term.toLowerCase();
      if (!businessTerms.has(term)) continue;
      if (BUSINESS_AMBIGUOUS.has(term) && !AMBIGUOUS.has(term)) inconsistent.push(term);
    }
    expect(inconsistent).toEqual([]);
  });

  it("indexes every alias back to a canonical term", () => {
    for (const s of SKILLS) {
      for (const alias of s.aliases) {
        expect(SKILL_INDEX.get(alias.toLowerCase())).toBeTruthy();
      }
    }
  });

  it("never lets a one-letter alias through without ambiguity marking", () => {
    // "c" and "r" are real languages and also two of the commonest letters in
    // English prose. They must always need context.
    for (const s of [...SKILLS, ...BUSINESS_SKILLS]) {
      for (const alias of [s.term, ...s.aliases]) {
        const a = alias.toLowerCase().trim();
        if (a.length > 1) continue;
        const marked = AMBIGUOUS.has(a) || BUSINESS_AMBIGUOUS.has(a);
        expect(marked, `one-letter alias "${a}" is not marked ambiguous`).toBe(true);
      }
    }
  });
});

describe("the dictionary in use", () => {
  it("does not turn ordinary job-description prose into a tech stack", () => {
    /*
     * The regression test for the whole class of bug. This is a sentence made
     * entirely of words that are, or could be, dictionary aliases — and none
     * of them is being used to name a technology.
     */
    const prose =
      "You will own the product lifecycle, manage the delivery pipeline, " +
      "scale the process across the business and drive quality improvements " +
      "in an agile environment.";
    expect(extractSkills(prose)).toEqual([]);
  });

  it("still finds a real stack in an ordinary sentence", () => {
    const skills = extractSkills(
      "You will build services in Python and Go, deployed to Kubernetes on AWS.",
    );
    expect(skills).toContain("python");
    expect(skills).toContain("kubernetes");
    expect(skills).toContain("aws");
  });
});
