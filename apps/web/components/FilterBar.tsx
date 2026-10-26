"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, X, SlidersHorizontal } from "lucide-react";
import { FUNCTION_LABEL, REGION, REMOTE, SENIORITY } from "@/lib/format";
import { searchUrl } from "@/lib/routes";
import { WormSpinner } from "./ui/WormSpinner";

type Facets = {
  regions?: Record<string, number>;
  functions?: Record<string, number>;
  seniority?: Record<string, number>;
  remote?: Record<string, number>;
};

const GROUPS = [
  { key: "region", label: "Region", labels: REGION, facet: "regions" },
  { key: "function", label: "Field", labels: FUNCTION_LABEL, facet: "functions" },
  { key: "seniority", label: "Seniority", labels: SENIORITY, facet: "seniority" },
  { key: "remote", label: "Work setup", labels: REMOTE, facet: "remote" },
] as const;

/**
 * How recently the job was posted.
 *
 * Single-select and not a facet, so it sits outside GROUPS. It matters most for
 * the social sources: a job board closes a role when it is filled, but nobody
 * deletes an old hiring post, so on Facebook and LinkedIn age IS the freshness
 * signal. The backend has supported `posted_within_days` all along and there
 * was simply no control for it.
 */
/**
 * Where the listing came from, grouped by what it means to the applicant rather
 * than by vendor. Nobody searching for a job cares whether the ATS is Comeet or
 * Greenhouse; they care whether they apply on the employer's own site.
 */
const SOURCE_GROUPS: [string, string, string[]][] = [
  ["direct", "Direct from employer", [
    "comeet", "greenhouse", "lever", "ashby", "workable",
    "smartrecruiters", "recruitee", "workday", "personio", "bamboohr",
  ]],
  // All three of the original entries — drushim, alljobs, yad2 — are withheld
  // sources, so this toggle had been returning nothing at all. These are the
  // boards actually in the index. `workable` is deliberately NOT here: the ATS
  // crawler and the aggregated-board scraper both write source_provider
  // 'workable', so the same 74 rows would appear under "Direct from employer"
  // as well — and direct is where they belong, since you apply on the
  // employer's own Workable page either way.
  ["boards", "Job boards", ["drushimavodot", "secrettelaviv", "revhub"]],
  ["social", "Social posts", ["facebook", "linkedin"]],
];

const POSTED_OPTIONS: [string, string][] = [
  ["1", "Past 24 hours"],
  ["3", "Past 3 days"],
  ["7", "Past week"],
  ["30", "Past month"],
];

/**
 * Filters as a row of capsules that stick to the top of the results.
 *
 * They used to be a tall column in the page flow, which meant they scrolled
 * away exactly when you needed them: you would read four jobs, decide to narrow
 * to Haifa, and have to scroll back up to do it. Sticking them costs one line
 * of vertical space and keeps the controls next to the thing they control.
 *
 * Each group is a dropdown rather than a permanently expanded list, because the
 * four lists together run to about forty options and none of them are worth
 * forty lines of screen before you have chosen anything.
 */
export default function FilterBar({ facets }: { facets: Facets }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Filter clicks re-render the results server-side; say so while it happens.
  const [pending, startTransition] = useTransition();

  // A dropdown that only closes via its own button is a trap on touch, where
  // there is no Escape key.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    const current = sp.getAll(key);
    sp.delete(key);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    for (const v of next) sp.append(key, v);
    sp.delete("page");
    startTransition(() => router.push(searchUrl(sp)));
  }

  const days = params.get("days");

  /** Single-select, so setting a value replaces rather than appends. */
  function setDays(value: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set("days", value);
    else sp.delete("days");
    sp.delete("page");
    startTransition(() => router.push(searchUrl(sp)));
    setOpen(null);
  }

  function clearAll() {
    const sp = new URLSearchParams();
    const q = params.get("q");
    if (q) sp.set("q", q);
    startTransition(() => router.push(searchUrl(sp)));
    setOpen(null);
  }

  const selectedSources = params.getAll("source");
  const advancedActive =
    selectedSources.length > 0 ||
    params.get("salary") === "1" ||
    Boolean(params.get("exclude")) ||
    params.get("junior") === "1" ||
    params.get("nodegree") === "1" ||
    params.get("hebrew") === "1" ||
    Boolean(params.get("years"));

  /** Set or clear a single-value parameter. */
  function setParam(key: string, value: string | null) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    sp.delete("page");
    startTransition(() => router.push(searchUrl(sp)));
  }

  /** Source groups map to several providers, so they toggle as a set. */
  function toggleSourceGroup(providers: string[], active: boolean) {
    const sp = new URLSearchParams(params.toString());
    const current = sp.getAll("source");
    sp.delete("source");
    const next = active
      ? current.filter((v) => !providers.includes(v))
      : [...new Set([...current, ...providers])];
    for (const v of next) sp.append("source", v);
    sp.delete("page");
    startTransition(() => router.push(searchUrl(sp)));
  }

  const activeCount =
    GROUPS.reduce((n, g) => n + params.getAll(g.key).length, 0) +
    (days ? 1 : 0) +
    (advancedActive ? 1 : 0);

  return (
    <div
      ref={wrapRef}
      className="sticky top-[57px] z-20 -mx-4 mb-5 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Posted-time first: it is the filter people reach for most. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(open === "posted" ? null : "posted")}
            aria-expanded={open === "posted"}
            aria-haspopup="true"
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3.5 text-sm font-medium transition-colors ${
              days
                ? "border-action bg-accent-tint text-accent-text"
                : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
            }`}
          >
            {days ? POSTED_OPTIONS.find(([v]) => v === days)?.[1] ?? "Posted" : "Posted"}
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${open === "posted" ? "rotate-180" : ""}`}
            />
          </button>

          {open === "posted" ? (
            <div
              role="group"
              aria-label="Posted"
              className="absolute start-0 top-[calc(100%+6px)] z-30 w-[min(15rem,calc(100vw-2rem))] rounded-card border border-line bg-surface p-2 shadow-lg"
            >
              {POSTED_OPTIONS.map(([value, label]) => {
                const on = days === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDays(on ? null : value)}
                    className={`flex min-h-10 w-full items-center rounded-control px-3 text-start text-sm transition-colors ${
                      on
                        ? "bg-accent-tint font-medium text-accent-text"
                        : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {GROUPS.map((group) => {
          const counts = (facets[group.facet] ?? {}) as Record<string, number>;
          const options = Object.entries(counts)
            .filter(([value, n]) => n > 0 && value !== "unknown" && group.labels[value])
            .sort((a, b) => b[1] - a[1]);
          if (!options.length) return null;

          const selected = params.getAll(group.key);
          const isOpen = open === group.key;

          return (
            <div key={group.key} className="relative">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : group.key)}
                aria-expanded={isOpen}
                aria-haspopup="true"
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3.5 text-sm font-medium transition-colors ${
                  selected.length
                    ? "border-action bg-accent-tint text-accent-text"
                    : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
                }`}
              >
                {group.label}
                {selected.length ? (
                  <span className="numeral rounded-chip bg-action px-1.5 text-xs text-on-action">
                    {selected.length}
                  </span>
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen ? (
                <div
                  role="group"
                  aria-label={group.label}
                  className="absolute start-0 top-[calc(100%+6px)] z-30 max-h-[60vh] w-[min(19rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-lg"
                >
                  {options.map(([value, n]) => {
                    const on = selected.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(group.key, value)}
                        className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-control px-3 text-start text-sm transition-colors ${
                          on
                            ? "bg-accent-tint font-medium text-accent-text"
                            : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                        }`}
                      >
                        {/* Labels mix Hebrew and Latin ("DevOps ו-SRE"), so the
                            count needs its own bidi isolate or it reorders. */}
                        <bdi>{group.labels[value]}</bdi>
                        <bdi className="numeral shrink-0 text-xs opacity-70">{n}</bdi>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {pending ? (
          <WormSpinner size={26} label="Updating results" className="ms-1 shrink-0" />
        ) : null}

        <button
          type="button"
          onClick={() => setOpen(open === "advanced" ? null : "advanced")}
          aria-expanded={open === "advanced"}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3.5 text-sm font-medium transition-colors ${
            advancedActive
              ? "border-action bg-accent-tint text-accent-text"
              : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
          }`}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Advanced
        </button>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-fg-2 transition-colors hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
            Clear {activeCount}
          </button>
        ) : null}
      </div>

      {/*
        Advanced sits in the flow rather than in a popover: its controls are a
        text field and two groups of toggles, which is more than a dropdown can
        hold comfortably, and it is the one panel people keep open while they
        refine.
      */}
      {open === "advanced" ? (
        <div className="mt-3 grid grid-cols-1 gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="exclude" className="mb-1.5 block text-sm font-medium">
              Exclude words
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("exclude");
                setParam("exclude", String(v || "").trim() || null);
              }}
            >
              <input
                id="exclude"
                name="exclude"
                defaultValue={params.get("exclude") ?? ""}
                placeholder="e.g. senior, manager"
                className="min-h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm focus:border-action"
              />
            </form>
            <p className="m-0 mt-1.5 text-xs text-fg-2">
              Press Enter. You can also type <code>-word</code> to exclude and{" "}
              <code>&quot;exact phrase&quot;</code> in the search box itself.
            </p>
          </div>

          <div>
            <p className="m-0 mb-1.5 text-sm font-medium">Source</p>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_GROUPS.map(([key, label, providers]) => {
                const active = providers.some((pv) => selectedSources.includes(pv));
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleSourceGroup(providers, active)}
                    className={`inline-flex min-h-9 items-center rounded-control border px-3 text-[13px] font-medium transition-colors ${
                      active
                        ? "border-action bg-accent-tint text-accent-text"
                        : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="m-0 mt-3 mb-1.5 text-sm font-medium">Salary</p>
            <button
              type="button"
              aria-pressed={params.get("salary") === "1"}
              onClick={() =>
                setParam("salary", params.get("salary") === "1" ? null : "1")
              }
              className={`inline-flex min-h-9 items-center rounded-control border px-3 text-[13px] font-medium transition-colors ${
                params.get("salary") === "1"
                  ? "border-action bg-accent-tint text-accent-text"
                  : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
              }`}
            >
              Only jobs that state a salary
            </button>
          </div>

          {/*
            The barriers, as filters.

            Each of these is a reason somebody closes a listing without
            applying — too many years asked for, a degree they do not have,
            Hebrew they do not speak. The index has known all three since
            decomposition was written and has never let anybody search on them.

            "Junior-friendly" deliberately includes postings that state no year
            figure at all but are titled junior or student: about a third of
            listings never state one, and excluding them would hide most of the
            junior market behind the filter meant to find it.
          */}
          <div className="sm:col-span-2">
            <p className="m-0 mb-1.5 text-sm font-medium">Barriers</p>
            <div className="flex flex-wrap gap-1.5">
              <Toggle
                active={params.get("junior") === "1"}
                onClick={() => setParam("junior", params.get("junior") === "1" ? null : "1")}
              >
                Junior-friendly
              </Toggle>
              <Toggle
                active={params.get("nodegree") === "1"}
                onClick={() =>
                  setParam("nodegree", params.get("nodegree") === "1" ? null : "1")
                }
              >
                No degree required
              </Toggle>
              <Toggle
                active={params.get("hebrew") === "1"}
                onClick={() => setParam("hebrew", params.get("hebrew") === "1" ? null : "1")}
              >
                Hebrew not required
              </Toggle>
            </div>

            <label htmlFor="years" className="mb-1.5 mt-3 block text-sm font-medium">
              Most years of experience asked for
            </label>
            <select
              id="years"
              value={params.get("years") ?? ""}
              onChange={(e) => setParam("years", e.target.value || null)}
              className="min-h-10 rounded-control border border-line-strong bg-surface px-3 text-sm focus:border-action"
            >
              <option value="">Any</option>
              {[1, 2, 3, 5, 7, 10].map((n) => (
                <option key={n} value={String(n)}>
                  Up to {n} {n === 1 ? "year" : "years"}
                </option>
              ))}
            </select>
            <p className="m-0 mt-1.5 text-xs text-fg-2">
              Includes listings that never say, because most of them do not.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One advanced toggle.
 *
 * The same nine-line className was being retyped for every chip in this panel,
 * and the two that already existed had drifted apart by a border colour.
 */
function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center rounded-control border px-3 text-[13px] font-medium transition-colors ${
        active
          ? "border-action bg-accent-tint text-accent-text"
          : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
