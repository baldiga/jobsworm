"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { ChipToggle } from "./ui/Chip";
import { Button } from "./ui/Button";
import { REGION, SENIORITY, REMOTE, FUNCTION_LABEL } from "@/lib/format";

type Profile = {
  headline: string | null;
  skills: string[] | null;
  preferred_titles: string[] | null;
  regions: string[] | null;
  seniority: string | null;
  seniority_levels: string[] | null;
  job_functions: string[] | null;
  remote_prefs: string[] | null;
  years_experience: number | null;
  cv_parsed_at: string | null;
  job_function: string | null;
};

/*
 * Options come from the shared label maps so the profile editor and the search
 * filters can never drift apart. The keys are what gets stored; the values are
 * only ever presentation.
 */
const REGION_OPTIONS: [string, string][] = [
  "tel_aviv", "center", "sharon", "shfela", "jerusalem", "haifa", "north", "south",
].map((k) => [k, REGION[k]]);

const SENIORITY_OPTIONS: [string, string][] = [
  "student", "junior", "mid", "senior", "lead", "manager",
].map((k) => [k, SENIORITY[k]]);

const REMOTE_OPTIONS: [string, string][] = [
  "onsite", "hybrid", "remote",
].map((k) => [k, REMOTE[k]]);

/**
 * Your field. Classified from the CV, and the single biggest lever on what you
 * are shown: the classifier reads a RevOps CV as operations about as often as
 * marketing, and it has no way to know which you actually want next.
 */
const FUNCTION_OPTIONS: [string, string][] = [
  "software_engineering", "data", "devops", "qa", "security", "it_support",
  "product", "design", "hardware", "ai_ml", "tech_pm", "technical_writing",
  "solutions_engineering", "marketing", "sales", "customer_success",
  "operations", "finance", "hr",
].map((k) => [k, FUNCTION_LABEL[k]]);

export default function ProfileEditor({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [headline, setHeadline] = useState(profile?.headline ?? "");
  const [skills, setSkills] = useState<string[]>(profile?.skills ?? []);
  const [titles] = useState<string[]>(profile?.preferred_titles ?? []);
  const [regions, setRegions] = useState<string[]>(profile?.regions ?? []);
  /*
    * All four of these are arrays now. Seniority, field and work setup used to
    * be single-valued while Regions beside them was not, which was reported as
    * the inconsistency it was: "I may want to choose Mid-Level, Senior and
    * Manager, same should be enabled in 'your field' and 'work setup'; this is
    * already done in 'Regions'."
    *
    * Each falls back to the single column, so a profile filled in before the
    * change — or by the CV parser, which still writes `job_function` — opens
    * with its existing choice selected rather than blank.
    */
  const [seniority, setSeniority] = useState<string[]>(
    profile?.seniority_levels?.length
      ? profile.seniority_levels
      : profile?.seniority
        ? [profile.seniority]
        : [],
  );
  const [remote, setRemote] = useState<string[]>(profile?.remote_prefs ?? []);
  const [jobFunction, setJobFunction] = useState<string[]>(
    profile?.job_functions?.length
      ? profile.job_functions
      : profile?.job_function
        ? [profile.job_function]
        : [],
  );
  /*
   * Years of experience, editable.
   *
   * It was written by the CV parser and by nothing else, and there was no
   * input for it anywhere — so somebody whose CV parsed badly was stuck with
   * the wrong number and no way to say so. That is half of a bug reported on
   * 2026-09-12: "calculated my work experience as 12 years ... I can't fix it
   * manually."
   *
   * Held as a string rather than a number because "" is a real state a number
   * input can be in, and coercing it to 0 mid-typing would tell somebody they
   * have no experience the moment they clear the field to retype it.
   */
  const [years, setYears] = useState(
    profile?.years_experience != null ? String(profile.years_experience) : "",
  );
  const [skillDraft, setSkillDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], set: (v: string[]) => void, value: string) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    setSaved(false);
  }

  function addSkill() {
    const s = skillDraft.trim().toLowerCase();
    if (!s) return;
    if (!skills.includes(s)) setSkills([...skills, s]);
    setSkillDraft("");
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline,
          skills,
          preferred_titles: titles,
          regions,
          seniority_levels: seniority,
          remote_prefs: remote,
          job_functions: jobFunction,
          // Omitted entirely when blank, so clearing the box leaves whatever
          // the CV found rather than writing a zero the person did not mean.
          ...(years.trim() === "" ? {} : { years_experience: Number(years) }),
        }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      router.refresh();
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="headline" className="mb-1.5 block text-sm font-medium">
          Headline
        </label>
        <input
          id="headline"
          name="headline"
          value={headline}
          onChange={(e) => {
            setHeadline(e.target.value);
            setSaved(false);
          }}
          placeholder="Backend developer, 5 years experience"
          maxLength={120}
          className="min-h-11 w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 focus:border-action"
        />
      </div>

      <div>
        <label htmlFor="years" className="mb-1.5 block text-sm font-medium">
          Years of experience
        </label>
        <input
          id="years"
          name="years"
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          value={years}
          onChange={(e) => {
            setYears(e.target.value);
            setSaved(false);
          }}
          placeholder="5"
          className="numeral min-h-11 w-28 rounded-control border border-line-strong bg-surface px-3 py-2.5 focus:border-action"
        />
        <p className="m-0 mt-1.5 text-xs text-fg-2">
          Read from your CV, and often wrong when a CV lists a degree or army service with
          dates. Whatever you put here wins.
        </p>
      </div>

      <fieldset className="border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-medium">
          Skills
          <span className="ms-2 font-normal text-fg-2">
            {skills.length
              ? `${skills.length} ${skills.length === 1 ? "skill" : "skills"}`
              : "These drive your matches"}
          </span>
        </legend>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggle(skills, setSkills, s)}
              className="group inline-flex min-h-9 items-center gap-1.5 rounded-chip border border-transparent bg-accent-tint px-2.5 py-0.5 text-[13px] leading-6 text-accent-text transition-colors hover:border-action"
              aria-label={`Remove ${s}`}
            >
              <bdi>{s}</bdi>
              <X aria-hidden="true" className="size-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
          {!skills.length ? (
            <span className="text-sm text-fg-2">
              None yet. Upload a CV or add them by hand.
            </span>
          ) : null}
        </div>

        <div className="flex gap-2">
          <label htmlFor="skill-draft" className="sr-only">
            Add a skill
          </label>
          <input
            id="skill-draft"
            name="skill-draft"
            value={skillDraft}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkill();
              }
            }}
            placeholder="Add a skill, e.g. postgresql"
            className="h-11 flex-1 rounded-control border border-line-strong bg-surface px-3 focus:border-action"
          />
          <Button type="button" variant="ghost" size="sm" onClick={addSkill}>
            Add
          </Button>
        </div>
      </fieldset>

      <ChipGroup
        label="Your field"
        hint="Choose as many as fit. Empty means no preference."
        options={FUNCTION_OPTIONS}
        selected={jobFunction}
        onToggle={(v) => toggle(jobFunction, setJobFunction, v)}
      />

      <ChipGroup
        label="Seniority"
        hint="Choose every level you would take, not just your current one."
        options={SENIORITY_OPTIONS}
        selected={seniority}
        onToggle={(v) => toggle(seniority, setSeniority, v)}
      />

      <ChipGroup
        label="Work setup"
        hint="Choose as many as fit. Empty means no preference."
        options={REMOTE_OPTIONS}
        selected={remote}
        onToggle={(v) => toggle(remote, setRemote, v)}
      />

      <ChipGroup
        label="Regions"
        options={REGION_OPTIONS}
        selected={regions}
        onToggle={(v) => toggle(regions, setRegions, v)}
      />

      {error ? (
        <p role="alert" className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {saved ? (
          <span role="status" className="text-sm font-medium text-ok">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  /**
   * Says that the group takes more than one answer.
   *
   * Chips look the same whether they behave as radios or checkboxes, and three
   * of these groups behaved as radios until recently. One line under the
   * legend is cheaper than letting people discover it by trying.
   */
  hint?: string;
  options: [string, string][];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{label}</legend>
      {hint ? <p className="m-0 mb-2 text-xs text-fg-2">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map(([value, text]) => (
          <ChipToggle
            key={value}
            selected={selected.includes(value)}
            onClick={() => onToggle(value)}
          >
            {text}
          </ChipToggle>
        ))}
      </div>
    </fieldset>
  );
}
