/**
 * `job_function` keyword sets and the tech-only gate — PLAN.md sections 5.2 and 4.5.
 *
 * Classification is a weighted keyword vote: title cues count 3x, description
 * cues 1x. The winner must beat the runner-up, otherwise the decomposition is
 * marked low-confidence and lands in the Claude labelling batch (PLAN 5.6).
 */

export type JobFunction =
  | "software_engineering"
  | "data"
  | "devops"
  | "qa"
  | "security"
  | "it_support"
  | "product"
  | "design"
  | "hardware"
  | "ai_ml"
  | "tech_pm"
  | "technical_writing"
  | "solutions_engineering"
  | "sales"
  | "marketing"
  | "customer_success"
  | "finance"
  | "hr"
  | "operations"
  | "legal"
  | "non_tech";

export interface FunctionDef {
  fn: JobFunction;
  /** Strong title cues — a hit here is worth 3 points. */
  title: readonly string[];
  /** Weaker body cues — 1 point each, capped. */
  body: readonly string[];
}

/**
 * Order matters only for tie-breaking: earlier entries win an exact tie, so the
 * more specific functions are listed before the generic ones.
 */
export const FUNCTION_DEFS: readonly FunctionDef[] = [
  {
    fn: "ai_ml",
    title: [
      "machine learning", "ml engineer", "mlops", "deep learning", "ai engineer",
      "ai researcher", "research scientist", "data scientist", "nlp engineer",
      "computer vision", "algorithm engineer", "algorithms engineer", "llm engineer",
      "applied scientist", "generative ai", "ai/ml",
      "מהנדס למידת מכונה", "מדען נתונים", "חוקר אלגוריתמים", "מהנדס אלגוריתמים",
      "אלגוריתמיקאי", "בינה מלאכותית",
    ],
    body: [
      "pytorch", "tensorflow", "scikit-learn", "hugging face", "transformers",
      "neural network", "model training", "feature engineering", "llm",
      "computer vision", "nlp", "reinforcement learning", "mlflow",
      "למידת מכונה", "רשתות נוירונים", "מודלים",
    ],
  },
  {
    fn: "data",
    title: [
      "data engineer", "data analyst", "analytics engineer", "bi developer",
      "bi analyst", "business intelligence", "data architect", "etl developer",
      "big data", "data platform", "analytics", "dwh",
      "מהנדס דאטה", "מהנדס נתונים", "אנליסט", "אנליסט נתונים", "מפתח bi",
      "ראש צוות דאטה",
    ],
    body: [
      "etl", "elt", "data pipeline", "data warehouse", "airflow", "dbt", "spark",
      "snowflake", "bigquery", "redshift", "looker", "tableau", "power bi",
      "data modeling", "dimensional", "kafka",
      "צנרת נתונים", "מחסן נתונים", "ניתוח נתונים",
    ],
  },
  {
    fn: "devops",
    title: [
      "devops", "sre", "site reliability", "platform engineer", "infrastructure engineer",
      "cloud engineer", "cloud architect", "production engineer", "build engineer",
      "release engineer", "kubernetes engineer", "systems engineer", "cloudops",
      "finops", "מהנדס devops", "מהנדס תשתיות", "מהנדס ענן",
    ],
    body: [
      "kubernetes", "terraform", "ci/cd", "jenkins", "argocd", "helm", "ansible",
      "prometheus", "grafana", "infrastructure as code", "docker", "gitops",
      "on-call", "observability", "תשתיות", "ענן",
    ],
  },
  {
    fn: "qa",
    title: [
      "qa engineer", "qa automation", "automation engineer", "test engineer",
      "sdet", "quality assurance", "qa lead", "test automation", "manual qa",
      "qa manager", "quality engineer",
      "מהנדס בדיקות", "בודק תוכנה", "בודק", "אוטומציה", "מהנדס אוטומציה",
      "בדיקות תוכנה",
    ],
    body: [
      "test cases", "test plan", "selenium", "cypress", "playwright", "pytest",
      "regression", "bug", "defects", "test automation", "appium",
      "בדיקות", "תרחישי בדיקה", "באגים",
    ],
  },
  {
    fn: "security",
    title: [
      "security engineer", "security researcher", "cyber security", "cybersecurity",
      "appsec", "application security", "product security", "infosec",
      "penetration tester", "malware researcher", "soc analyst", "security analyst",
      "security architect", "vulnerability researcher", "detection engineer",
      "מהנדס סייבר", "חוקר אבטחה", "אבטחת מידע", "סייבר", "חוקר סייבר",
    ],
    body: [
      "vulnerability", "exploit", "threat", "malware", "penetration testing",
      "owasp", "siem", "reverse engineering", "incident response", "soc",
      "encryption", "zero trust", "אבטחת מידע", "פרצות", "איומים",
    ],
  },
  {
    fn: "hardware",
    title: [
      "hardware engineer", "embedded engineer", "embedded software", "firmware engineer",
      "fpga engineer", "asic", "physical design", "verification engineer",
      "analog designer", "rf engineer", "chip design", "silicon", "vlsi",
      "electronics engineer", "board design", "mechanical engineer", "optics engineer",
      "מהנדס חומרה", "מהנדס אלקטרוניקה", "מהנדס משובץ", "מפתח אמבדד",
      "מהנדס תוכנה משובצת",
    ],
    body: [
      "verilog", "vhdl", "systemverilog", "fpga", "asic", "pcb", "rtos",
      "microcontroller", "schematic", "tapeout", "signal integrity", "jtag",
      "חומרה", "אלקטרוניקה", "מעגלים",
    ],
  },
  {
    fn: "it_support",
    title: [
      "it support", "helpdesk", "help desk", "system administrator", "sysadmin",
      "it manager", "it engineer", "desktop support", "network engineer",
      "network administrator", "technical support engineer", "support engineer",
      "it specialist", "service desk",
      "תמיכה טכנית", "מנהל רשת", "איש it", "טכנאי מחשבים", "מנהל מערכות מידע",
      "תומך טכני",
    ],
    body: [
      "active directory", "office 365", "windows server", "helpdesk", "ticket",
      "endpoint", "vpn", "onboarding hardware", "printers", "workstation",
      "תמיכה", "תקלות", "משתמשי קצה",
    ],
  },
  {
    fn: "technical_writing",
    title: [
      "technical writer", "documentation engineer", "content designer",
      "api documentation", "docs engineer", "technical communicator",
      "כותב טכני", "כתיבה טכנית",
    ],
    body: ["documentation", "docs", "user guides", "release notes", "style guide", "תיעוד"],
  },
  {
    fn: "solutions_engineering",
    title: [
      "solutions engineer", "solution engineer", "sales engineer",
      "solutions architect", "solution architect", "pre-sales", "presales",
      "field engineer", "implementation engineer", "customer engineer",
      "professional services engineer", "integration engineer",
      "מהנדס פתרונות", "מהנדס מכירות", "ארכיטקט פתרונות", "מיישם",
    ],
    body: [
      "pre-sales", "poc", "customer facing", "demos", "rfp", "integration",
      "professional services", "הטמעה", "לקוחות",
    ],
  },
  {
    fn: "tech_pm",
    title: [
      "technical program manager", "tpm", "project manager", "program manager",
      "delivery manager", "scrum master", "agile coach", "release manager",
      "engineering program", "r&d project manager",
      "מנהל פרויקטים", "מנהל תוכנית", "סקראם מאסטר", "מנהל פרויקט",
    ],
    body: ["scrum", "sprint", "roadmap", "stakeholders", "jira", "gantt", "אג'יל", "ספרינט"],
  },
  {
    fn: "product",
    title: [
      "product manager", "product owner", "group product manager", "director of product",
      "vp product", "cpo", "product analyst", "product lead", "growth product",
      "מנהל מוצר", "בעלים של מוצר", "מנהל מוצר בכיר",
    ],
    body: ["roadmap", "user stories", "prd", "product strategy", "kpi", "מוצר", "אפיון"],
  },
  {
    fn: "design",
    title: [
      "ux designer", "ui designer", "ux/ui", "ui/ux", "product designer",
      "visual designer", "graphic designer", "interaction designer", "ux researcher",
      "design lead", "creative director", "motion designer", "brand designer",
      "מעצב", "מעצב חווית משתמש", "מעצב ממשק", "מעצב מוצר", "מעצב גרפי",
    ],
    body: [
      "figma", "sketch", "wireframe", "prototype", "design system", "user research",
      "usability", "עיצוב", "אבטיפוס",
    ],
  },
  {
    fn: "software_engineering",
    title: [
      "software engineer", "software developer", "backend engineer", "back end engineer",
      "backend developer", "frontend engineer", "front end engineer", "frontend developer",
      "fullstack", "full stack", "full-stack", "web developer", "mobile developer",
      "ios developer", "android developer", "ios engineer", "android engineer",
      "developer", "programmer", "software architect", "tech lead", "engineering manager",
      "r&d engineer", "platform developer", "api developer", "game developer",
      "salesforce developer", "sap developer", "erp developer", "automation developer",
      "מפתח", "מפתח תוכנה", "מפתח backend", "מפתח frontend", "מפתח פול סטאק",
      "מהנדס תוכנה", "מתכנת", "ראש צוות פיתוח", "מנהל פיתוח", "ארכיטקט תוכנה",
    ],
    body: [
      "code", "api", "microservices", "backend", "frontend", "software development",
      "design patterns", "algorithms", "git", "unit tests", "production code",
      "פיתוח", "קוד", "מערכות",
    ],
  },

  // --- business functions: kept only when the company is a tech company (4.5)
  {
    fn: "sales",
    title: [
      "account executive", "sales manager", "sales representative", "sdr",
      "bdr", "business development", "account manager", "vp sales", "cro",
      "sales director", "channel manager", "inside sales",
      "מנהל מכירות", "איש מכירות", "פיתוח עסקי", "מנהל לקוחות",
    ],
    body: ["quota", "pipeline", "crm", "closing deals", "prospecting", "מכירות", "יעדים"],
  },
  {
    fn: "marketing",
    title: [
      "marketing manager", "growth manager", "demand generation", "content marketing",
      "product marketing", "performance marketing", "seo", "ppc", "social media manager",
      "brand manager", "cmo", "communications manager", "community manager",
      "מנהל שיווק", "שיווק", "מנהל תוכן", "מנהל קמפיינים",
    ],
    body: ["campaign", "seo", "funnel", "leads", "brand", "gtm", "שיווק", "קמפיין"],
  },
  {
    fn: "customer_success",
    title: [
      "customer success", "csm", "customer support", "technical account manager",
      "account director", "onboarding specialist", "renewals manager",
      "customer experience", "support representative",
      "מנהל הצלחת לקוח", "שירות לקוחות", "נציג שירות",
    ],
    body: ["churn", "retention", "customer satisfaction", "escalation", "לקוחות", "שימור"],
  },
  {
    fn: "finance",
    title: [
      "controller", "accountant", "financial analyst", "fp&a", "cfo",
      "bookkeeper", "revenue analyst", "treasury", "payroll",
      "חשב", "רואה חשבון", "מנהל כספים", "חשבת שכר", "כלכלן", "סמנכל כספים",
    ],
    body: ["gaap", "ifrs", "budget", "forecast", "audit", "invoices", "חשבונאות", "תקציב"],
  },
  {
    fn: "hr",
    title: [
      "recruiter", "talent acquisition", "hr business partner", "hrbp",
      "hr manager", "people operations", "chro", "sourcer", "hr generalist",
      "learning and development", "compensation and benefits",
      "מגייס", "גיוס", "משאבי אנוש", "מנהל משאבי אנוש", "רכז גיוס",
    ],
    body: ["sourcing", "candidates", "interviews", "onboarding", "גיוס", "מועמדים"],
  },
  {
    fn: "operations",
    title: [
      "operations manager", "office manager", "logistics", "supply chain",
      "procurement", "facilities", "bizops", "business operations", "revops",
      "executive assistant", "operations specialist",
      "מנהל תפעול", "תפעול", "רכש", "לוגיסטיקה", "מנהל משרד",
    ],
    body: ["vendors", "process improvement", "logistics", "inventory", "תפעול", "ספקים"],
  },
  {
    fn: "legal",
    title: [
      "legal counsel", "general counsel", "corporate counsel", "compliance officer",
      "privacy counsel", "paralegal", "contracts manager", "attorney", "lawyer",
      "יועץ משפטי", "עורך דין", "ממונה ציות",
    ],
    body: ["contracts", "compliance", "regulatory", "gdpr", "litigation", "משפטי", "חוזים"],
  },
];

/** PLAN.md 4.5 — TECH_FUNCTIONS. */
export const TECH_FUNCTIONS: ReadonlySet<JobFunction> = new Set<JobFunction>([
  "software_engineering",
  "data",
  "devops",
  "qa",
  "security",
  "it_support",
  "product",
  "design",
  "hardware",
  "ai_ml",
  "tech_pm",
  "technical_writing",
  "solutions_engineering",
]);

/**
 * PLAN.md 4.5 — business functions that pass the gate only when the employer is
 * itself a tech company.
 */
export const BUSINESS_FUNCTIONS: ReadonlySet<JobFunction> = new Set<JobFunction>([
  "sales",
  "marketing",
  "customer_success",
  "finance",
  "hr",
  "operations",
  "legal",
]);

/** Substrings that mark `companies.industry` as a tech industry. */
export const TECH_INDUSTRIES: readonly string[] = [
  "software", "saas", "internet", "information technology", "it services",
  "computer", "technology", "high tech", "hi-tech", "hightech", "tech",
  "cyber", "security", "fintech", "insurtech", "adtech", "martech", "proptech",
  "foodtech", "agritech", "climatetech", "healthtech", "medtech", "biotech",
  "digital health", "semiconductor", "electronics", "hardware", "telecom",
  "communications", "networking", "cloud", "data", "analytics", "artificial intelligence",
  "machine learning", "robotics", "automotive tech", "mobility", "autotech",
  "aerospace", "defense", "gaming", "games", "e-commerce", "ecommerce",
  "marketplace", "mobile", "developer tools", "devtools", "startup",
  "הייטק", "טכנולוגיה", "תוכנה", "סייבר", "אבטחת מידע", "אלקטרוניקה", "שבבים",
];

/**
 * PLAN.md 4.5 tech-only gate.
 *
 * Keep when the function is a tech function, or when it is a business function
 * inside a tech company. `non_tech` never passes.
 *
 * `techContext` is what a missing `companyIndustry` used to cost us. Only ATS
 * feeds carry an industry; Facebook, Drushim and AllJobs have no `companies`
 * row at all, so `companyIndustry` was null for every scraped job and the
 * business-function branch could never be reached. The gate silently dropped
 * every marketing, sales, RevOps, finance and HR role from those sources —
 * 1,090 Facebook posts in one pass — and the index held exactly zero of them.
 *
 * That was not the intended policy. The rule was "business roles count when the
 * employer is a tech company", and for these sources we already know that from
 * where the job was found: we only crawl hi-tech categories on the job boards
 * and hi-tech hiring groups on Facebook. `techContext` carries that knowledge
 * to the gate instead of throwing it away.
 */
export function isTech(
  fn: JobFunction,
  companyIndustry?: string | null,
  opts?: { techContext?: boolean },
): boolean {
  if (TECH_FUNCTIONS.has(fn)) return true;
  if (!BUSINESS_FUNCTIONS.has(fn)) return false;
  if (companyIndustry) {
    const ind = companyIndustry.toLowerCase();
    if (TECH_INDUSTRIES.some((t) => ind.includes(t))) return true;
  }
  return Boolean(opts?.techContext);
}

/** Sub-function cues, applied only when `function === "software_engineering"`. */
export const SUB_FUNCTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["fullstack", ["fullstack", "full stack", "full-stack", "פול סטאק", "פולסטאק"]],
  ["backend", ["backend", "back end", "back-end", "server side", "server-side", "בק אנד", "צד שרת"]],
  ["frontend", ["frontend", "front end", "front-end", "client side", "web developer", "פרונט אנד", "צד לקוח"]],
  ["mobile", ["mobile", "ios", "android", "react native", "flutter", "מובייל"]],
  ["embedded", ["embedded", "firmware", "אמבדד", "משובצת"]],
  ["game", ["game developer", "unity", "unreal", "gameplay"]],
  ["infrastructure", ["infrastructure", "core platform", "low level", "low-level", "תשתית"]],
];
