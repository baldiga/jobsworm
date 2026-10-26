/**
 * `@jobsworm/core` — normalization, dictionaries and rule-based job
 * decomposition. Pure, dependency-free, and safe to import from the web app,
 * the ingestion CLI and the MCP route alike.
 */

export * from "./normalize";
export * from "./text";
export * from "./types";
export * from "./decompose";
export * from "./synonyms";
export * from "./cv";
export * from "./rtl";
export * from "./seeker";
export * from "./pricing";
export * from "./compensation";
export * from "./match-why";

export {
  CITIES,
  CITY_INDEX,
  CITY_COUNT,
  ISRAEL_ALIASES,
  ABROAD_TERMS,
  type CityEntry,
  type Region,
} from "./data/locations";

export {
  SKILLS,
  SKILL_INDEX,
  SKILL_CATEGORY,
  SKILL_TERM_COUNT,
  SKILL_ALIAS_COUNT,
  AMBIGUOUS,
  type SkillCategory,
} from "./data/skills";

export {
  FUNCTION_DEFS,
  SUB_FUNCTIONS,
  TECH_FUNCTIONS,
  BUSINESS_FUNCTIONS,
  TECH_INDUSTRIES,
  type JobFunction,
  type FunctionDef,
} from "./data/functions";

export {
  AGENCY_NAMES,
  AGENCY_STRONG_CUES,
  AGENCY_WEAK_CUES,
} from "./data/agencies";

export { FREEMAIL_DOMAINS, isFreemail, emailDomain } from "./data/freemail";
