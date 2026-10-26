/**
 * The job decomposition schema — PLAN.md section 5.1, in camelCase.
 *
 * The DB columns are snake_case; the mapping happens once, in
 * `@jobsworm/adapters/src/ingest.ts`.
 */

import type { JobFunction } from "./data/functions";
import type { Region } from "./data/locations";

export type { JobFunction, Region };

export type Seniority =
  | "student"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "director"
  | "exec";

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "freelance"
  | "student"
  | "internship";

export type RemoteMode = "onsite" | "hybrid" | "remote" | "unknown";

export type LanguageLevel = "required" | "advantage" | "none";

export type Education =
  | "none"
  | "bsc_required"
  | "bsc_advantage"
  | "msc_required"
  | "phd";

export type ApplyMethod = "ats" | "email" | "dm" | "link";

export type Lang = "he" | "en" | "mixed";

/** Provenance for an inferred field — PLAN.md section 5. */
export type FieldSource = "feed" | "rule" | "llm";

export interface FieldMeta {
  conf: number;
  src: FieldSource;
}

/** `_conf` / `_src` for every inferred field, keyed by field name. */
export type DecompMeta = Record<string, FieldMeta>;

export interface JobLocation {
  raw: string | null;
  city: string | null;
  cities: string[];
  region: Region | null;
  lat: number | null;
  lng: number | null;
  country: string;
  abroad: boolean;
}

export interface Salary {
  min: number | null;
  max: number | null;
  currency: "ILS" | "USD" | "EUR" | "GBP";
  period: "month" | "year" | "hour";
  raw: string;
  source: "posting";
}

export interface Languages {
  hebrew: LanguageLevel;
  english: LanguageLevel;
}

export type QualityFlag =
  | "description_short"
  | "no_description"
  | "no_location"
  | "no_requirements"
  | "all_caps_title"
  | "too_many_skills"
  | "title_too_long";

export interface DecomposeInput {
  titleRaw: string;
  descriptionText: string;
  locationRaw?: string | null;
  companyName?: string | null;
  companyIndustry?: string | null;
  /**
   * True when the job was found somewhere that only carries tech hiring — a
   * hi-tech job-board category, a hi-tech Facebook group. Lets business-function
   * roles (marketing, sales, RevOps) through the 4.5 gate for sources that have
   * no `companies.industry` to check, which is all of the scraped ones.
   */
  techContext?: boolean;
  /** Feed provider or social platform the posting came from. */
  source: string;
  /** Feed-provided hints; used only when the rules find nothing. */
  departmentRaw?: string | null;
  salaryRaw?: string | null;
  employmentTypeRaw?: string | null;
}

export interface DecomposedJob {
  titleRaw: string;
  titleNorm: string;
  function: JobFunction;
  subFunction: string | null;
  seniority: Seniority | null;
  reqYearsMin: number | null;
  reqYearsMax: number | null;
  employmentType: EmploymentType;
  remote: RemoteMode;
  hybridDaysOffice: number | null;
  location: JobLocation;
  skillsRequired: string[];
  skillsNice: string[];
  techStack: string[];
  languages: Languages;
  education: Education;
  clearance: boolean;
  salary: Salary | null;
  isAgency: boolean;
  applyMethod: ApplyMethod;
  lang: Lang;
  qualityFlags: QualityFlag[];
  /** PLAN.md 4.5 gate result — false means the job is dropped on ingest. */
  isTech: boolean;
  decompVersion: string;
  decompMeta: DecompMeta;
}
