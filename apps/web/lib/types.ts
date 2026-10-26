export type JobRow = {
  id: string;
  company_id: string | null;
  title_raw: string | null;
  title_norm: string | null;
  function: string | null;
  sub_function: string | null;
  seniority: string | null;
  employment_type: string | null;
  remote: string | null;
  hybrid_days_office: number | null;
  location: unknown;
  skills_required: string[] | null;
  skills_nice: string[] | null;
  tech_stack: string[] | null;
  languages: unknown;
  education: string | null;
  clearance: boolean | null;
  salary: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: string | null;
    raw?: string | null;
  } | null;
  /*
   * Total compensation, when the employer stated one. Deliberately separate
   * from `salary`, which is monthly gross base — see 0034.
   */
  total_comp?: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: string | null;
    note?: string | null;
  } | null;
  benefits?: string[] | null;
  excerpt: string | null;
  description_html: string | null;
  description_text: string | null;
  apply_url: string | null;
  apply_method: string | null;
  /** The recruiter's own job number, on employer-posted listings only (0056). */
  apply_ref?: string | null;
  source_provider: string | null;
  source_url: string | null;
  lang: string | null;
  is_agency: boolean | null;
  company_hidden: boolean | null;
  quality_flags: string[] | null;
  /** Years of experience asked for. Returned by search since 0040. */
  req_years_min?: number | null;
  req_years_max?: number | null;
  posted_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  status: string | null;
  rank?: number | null;
  company_name_raw?: string | null;
  company_name?: string | null;
  company_slug?: string | null;
  company_domain?: string | null;

  /*
   * Paid placement (0034). Present on rows that came back from
   * `sponsored_jobs()`, and on a job page for a listing that was bought.
   * Everywhere else they are absent, which is why every one is optional: an
   * organic row has no opinion about sponsorship, it simply is not sponsored.
   */
  sponsored_campaign_id?: string | null;
  /** What was actually paid, in shekels. Printed on the card. */
  sponsored_price_usd?: number | string | null;
  /** Snapshot of the employer's logo at post time. See migration 0051. */
  company_logo_path?: string | null;
  sponsored_days?: number | null;
  sponsored_until?: string | null;
  sponsored_kind?: "employer" | "agency" | null;
};

export type CompanyRow = {
  id: string;
  slug: string;
  name_en: string | null;
  name_he: string | null;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  hq_city: string | null;
  careers_url: string | null;
  ats_provider: string | null;
  tech_stack: string[] | null;
};

export type SearchFilters = {
  regions?: string[];
  functions?: string[];
  seniority?: string[];
  remote?: string[];
  employment_types?: string[];
  has_salary?: boolean;
  posted_within_days?: number;
  company_id?: string;
  skills?: string[];
  /* 0040 — the barrier filters. */
  years_max?: number;
  junior_friendly?: boolean;
  no_degree?: boolean;
  hebrew_optional?: boolean;
};
