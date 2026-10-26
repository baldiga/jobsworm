"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BENEFITS,
  BENEFIT_GROUP_LABEL,
  FREE_DAYS,
  PACKAGES,
  SALARY_LIKELY_ANNUAL_ILS,
  SALARY_MAX_ILS,
  SALARY_MIN_ILS,
  checkSalary,
  priceUsd,
  pricePerDayUsd,
  type BenefitGroup,
} from "@jobsworm/core";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatUsd } from "@/lib/format";

/**
 * The posting form.
 *
 * ## The order of the page is the order of the decisions
 *
 * Describe the job, state what it pays, say how to apply — and only then,
 * once there is something real on the screen, choose how long it runs and
 * whether to promote it. Asking for money before the work is done is how a
 * form loses the people who would have paid; asking after it means the choice
 * is made with the listing in front of them.
 *
 * The free option is first in the list of lengths and is not hidden behind
 * anything. A free tier presented apologetically is worse than no free tier:
 * it teaches people that the paid one is the only real option and that we knew
 * it.
 *
 * ## Everything here is checked again on the server
 *
 * Nothing in this file is a security control. The salary bounds, the benefit
 * keys, the plan rules and the agency restriction are all enforced in the API
 * route and, for the load-bearing ones, in the database. This is here so a
 * mistake is a correction rather than a rejection.
 */

const REMOTE_CHOICES = [
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
];

const SENIORITY_CHOICES = [
  { value: "", label: "Not specified" },
  { value: "student", label: "Student / intern" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Team lead" },
  { value: "manager", label: "Manager" },
  { value: "director", label: "Director" },
  { value: "exec", label: "Executive" },
];

const EMPLOYMENT_CHOICES = [
  { value: "full_time", label: "Full time" },
  { value: "part_time", label: "Part time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "student", label: "Student position" },
];

const GROUP_ORDER: BenefitGroup[] = ["equity", "money", "time", "daily", "growth"];

const MIN_DESCRIPTION = 200;

export type CampaignDraft = {
  id?: string;
  title?: string;
  company_name?: string;
  city?: string;
  remote?: string;
  employment_type?: string;
  seniority?: string;
  description?: string;
  apply_to?: string;
  apply_ref?: string;
  salary_min?: string;
  salary_max?: string;
  tc_min?: string;
  tc_max?: string;
  tc_period?: "year" | "month";
  benefits?: string[];
  plan?: "free" | "sponsored";
  days?: number;
};

/**
 * The asterisk on a field that has to be filled in.
 *
 * `aria-hidden`, because every one of these inputs already carries the native
 * `required` attribute and a screen reader announces that itself. Reading
 * "star" on top of "required" is noise, and the mark exists for the people who
 * scan a form with their eyes — who otherwise find out which fields are
 * mandatory by submitting and being told.
 */
function Req() {
  return (
    <span aria-hidden="true" className="ms-1 font-normal text-bad">
      *
    </span>
  );
}

export default function CampaignForm({
  kind,
  orgName,
  initial,
  campaignId,
}: {
  kind: "employer" | "agency";
  orgName: string;
  initial?: CampaignDraft;
  /** Present when editing. Absent when creating. */
  campaignId?: string;
}) {
  const router = useRouter();
  const editing = Boolean(campaignId);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [companyName, setCompanyName] = useState(
    initial?.company_name ?? (kind === "agency" ? `Confidential client via ${orgName}` : orgName),
  );
  const [city, setCity] = useState(initial?.city ?? "");
  const [remote, setRemote] = useState(initial?.remote ?? "onsite");
  const [employmentType, setEmploymentType] = useState(initial?.employment_type ?? "full_time");
  const [seniority, setSeniority] = useState(initial?.seniority ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [applyTo, setApplyTo] = useState(initial?.apply_to ?? "");
  const [applyRef, setApplyRef] = useState(initial?.apply_ref ?? "");

  const [salaryMin, setSalaryMin] = useState(initial?.salary_min ?? "");
  const [salaryMax, setSalaryMax] = useState(initial?.salary_max ?? "");
  const [tcMin, setTcMin] = useState(initial?.tc_min ?? "");
  const [tcMax, setTcMax] = useState(initial?.tc_max ?? "");
  const [tcPeriod, setTcPeriod] = useState<"year" | "month">(initial?.tc_period ?? "year");
  const [benefits, setBenefits] = useState<string[]>(initial?.benefits ?? []);

  /*
   * An agency can never choose free (organic search is agency-free), so the
   * initial state is the paid one and the free row is not offered at all.
   * Showing a disabled option they must read an explanation for is worse than
   * showing a list that simply fits them.
   */
  const [days, setDays] = useState<number>(
    initial?.days ?? (kind === "agency" ? PACKAGES[1] : FREE_DAYS),
  );
  const [plan, setPlan] = useState<"free" | "sponsored">(
    initial?.plan ?? (kind === "agency" ? "sponsored" : "free"),
  );

  const [attested, setAttested] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Two steps: the role, then how long to run it.
   *
   * The whole thing was one column and the length picker sat at the bottom of
   * it, so choosing what to pay for meant scrolling past everything already
   * filled in. Splitting on "describe the job" / "decide the spend" also puts
   * the free-versus-paid choice on a screen of its own, where it is a decision
   * rather than a field near the end of a long form.
   */
  const [step, setStep] = useState<1 | 2>(1);

  const salary = useMemo(() => checkSalary(salaryMin, salaryMax), [salaryMin, salaryMax]);
  const looksAnnual = salary.ok && salary.value!.min >= SALARY_LIKELY_ANNUAL_ILS;
  const price = plan === "free" ? 0 : priceUsd(days);

  /*
   * Everything step one asks for. Checked before the step can be left, which
   * is not only a courtesy: step one stays in the DOM rather than unmounting
   * (so nothing typed is lost going back), and its inputs keep their `required`
   * attribute. Submitting with one of them empty would make the browser try to
   * focus a field that is not on screen, and it refuses — "an invalid form
   * control is not focusable" — which fails silently with no message anywhere.
   * Gating the step is what guarantees they are all filled by the time the
   * submit button exists.
   */
  const step1Ready =
    title.trim().length > 1 &&
    companyName.trim().length > 1 &&
    description.trim().length >= MIN_DESCRIPTION &&
    applyTo.trim().length > 3 &&
    salary.ok;

  const ready = step1Ready && attested;

  function goToStep2() {
    if (!step1Ready) {
      setError("Fill in the role first — title, company, description, salary and how to apply.");
      return;
    }
    setError(null);
    setStep(2);
    // Back to the top: step two opens below the fold otherwise, because the
    // page is still scrolled to wherever step one was left.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleBenefit(key: string) {
    setBenefits((b) => (b.includes(key) ? b.filter((k) => k !== key) : [...b, key]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    /*
     * Enter in a text field submits a form. On step one that would post a
     * half-built listing, so it advances instead — which is what pressing
     * Enter at the end of a form is for anyway.
     */
    if (step === 1) {
      goToStep2();
      return;
    }
    setError(null);
    setBusy(true);
    const body = {
      title: title.trim(),
      company_name: companyName.trim(),
      city: city.trim() || null,
      remote,
      employment_type: employmentType,
      seniority: seniority || null,
      description: description.trim(),
      apply_to: applyTo.trim(),
      apply_ref: applyRef.trim() || undefined,
      salary_min: salaryMin,
      salary_max: salaryMax,
      tc_min: tcMin || null,
      tc_max: tcMax || null,
      tc_period: tcPeriod,
      benefits,
      plan,
      days: plan === "free" ? FREE_DAYS : days,
    };
    try {
      const res = await fetch(
        editing ? `/api/recruit/campaigns/${campaignId}` : "/api/recruit/campaigns",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save the listing.");
        return;
      }
      /*
       * Straight to the payment page when there is one.
       *
       * A full navigation, not a router push: the checkout is somebody else's
       * site. When it is not configured the server returns null and we fall
       * back to the campaign page, which explains that an invoice is coming.
       */
      if (json.checkout_url) {
        window.location.href = json.checkout_url;
        return;
      }
      router.push(`/recruit/campaigns/${json.campaign_id ?? campaignId}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = "min-h-11 w-full rounded-control border border-line bg-surface px-3";

  return (
    <form onSubmit={submit} className="grid gap-8">
      {/*
        Stated once, at the top, rather than left for the reader to infer from
        the marks themselves. An asterisk is a convention, not a definition.
      */}
      <ol className="m-0 flex list-none gap-4 p-0 text-sm" aria-label="Progress">
        <li className={step === 1 ? "font-semibold text-fg" : "text-fg-2"}>
          1. The role {step === 2 ? <span aria-hidden="true">✓</span> : null}
        </li>
        <li className={step === 2 ? "font-semibold text-fg" : "text-fg-2"}>2. How long</li>
      </ol>

      <p className="m-0 text-sm text-fg-2">
        Fields marked <span className="text-bad">*</span> are required.
      </p>

      {/*
        Hidden with a class, not the `hidden` attribute.

        These wrappers carry `grid`, and a display value in a class beats the
        attribute — the step would stay visible and the form would show both at
        once. Hidden rather than unmounted so going back does not clear what
        was typed.
      */}
      <div className={step === 1 ? "grid gap-8" : "hidden"}>
      {/* ── 1. The role ───────────────────────────────────────────────────── */}
      <section className="grid gap-4">
        <h2 className="m-0 text-lg">The role</h2>

        <label className="grid gap-1.5">
          <span className="font-medium">
            Job title
            <Req />
          </span>
          <input
            required
            maxLength={140}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Senior Backend Engineer"
            className={field}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="font-medium">
            Company shown on the listing
            <Req />
          </span>
          <input
            required
            maxLength={120}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className={field}
          />
          {kind === "agency" ? (
            <span className="text-xs text-fg-2">
              You may keep the client confidential. The card will still say the listing was posted
              by an agency, and which one.
            </span>
          ) : null}
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="font-medium">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Tel Aviv"
              className={field}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="font-medium">Work setup</span>
            <select value={remote} onChange={(e) => setRemote(e.target.value)} className={field}>
              {REMOTE_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="font-medium">Employment type</span>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              className={field}
            >
              {EMPLOYMENT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="font-medium">Seniority</span>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              className={field}
            >
              {SENIORITY_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="font-medium">
            Description
            <Req />
          </span>
          <textarea
            required
            rows={12}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the role is, what the team does, what you are asking for."
            className="w-full rounded-card border border-line bg-surface p-3 leading-relaxed"
          />
          <span
            className={`text-xs ${
              description.trim().length >= MIN_DESCRIPTION ? "text-fg-2" : "text-warn-text"
            }`}
          >
            {description.trim().length} characters. At least {MIN_DESCRIPTION} — short listings get
            fewer applications and cannot be categorised properly.
          </span>
        </label>
      </section>

      {/* ── 2. Pay ────────────────────────────────────────────────────────── */}
      <section className="grid gap-4">
        <div>
          <h2 className="m-0 text-lg">Pay</h2>
          {/*
            Not "optional if you'd rather not". Every listing posted through
            Jobsworm shows a salary, and saying why converts far better than
            an asterisk: the people reading are the ones who complain about
            its absence everywhere else.
          */}
          <p className="m-0 mt-1 text-sm text-fg-2">
            Required. Every listing posted through Jobsworm shows a salary range — it is the first
            thing job seekers look for and the most common reason they skip a listing entirely.
          </p>
        </div>

        <fieldset className="grid gap-2 border-0 p-0">
          <legend className="mb-1 font-medium">
            Monthly gross base salary (₪)
            <Req />
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm text-fg-2">From</span>
              <input
                required
                inputMode="numeric"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                placeholder="25,000"
                className={`${field} numeral`}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm text-fg-2">To</span>
              <input
                required
                inputMode="numeric"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                placeholder="35,000"
                className={`${field} numeral`}
              />
            </label>
          </div>
          <span className="text-xs text-fg-2">
            Monthly, not annual. Between ₪{SALARY_MIN_ILS.toLocaleString("en-IL")} and ₪
            {SALARY_MAX_ILS.toLocaleString("en-IL")}. For a single figure, put it in both boxes.
          </span>

          {salaryMin && salaryMax && !salary.ok ? (
            <p role="alert" className="m-0 text-sm text-warn-text">
              {salaryProblemText(salary.problem)}
            </p>
          ) : null}

          {/*
            The soft check. ₪300,000 a month is legal by our bounds and almost
            always somebody's annual figure in the wrong box — ten times too
            large, in front of every reader. Asking beats both refusing it and
            publishing it silently.
          */}
          {looksAnnual ? (
            <p className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text">
              That reads as ₪{salary.value!.min.toLocaleString("en-IL")} a{" "}
              <strong className="font-semibold">month</strong>. If you meant the annual figure, put
              it in Total compensation below and the monthly base here.
            </p>
          ) : null}
        </fieldset>

        <details className="rounded-card border border-line bg-surface p-3">
          <summary className="cursor-pointer font-medium">
            Total compensation <span className="font-normal text-fg-2">(optional)</span>
          </summary>
          <p className="m-0 mt-2 text-sm text-fg-2">
            Shown as a second figure, never mixed into the base salary above.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm text-fg-2">From</span>
              <input
                inputMode="numeric"
                value={tcMin}
                onChange={(e) => setTcMin(e.target.value)}
                className={`${field} numeral`}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm text-fg-2">To</span>
              <input
                inputMode="numeric"
                value={tcMax}
                onChange={(e) => setTcMax(e.target.value)}
                className={`${field} numeral`}
              />
            </label>
          </div>
          <label className="mt-3 grid gap-1.5">
            <span className="text-sm text-fg-2">Period</span>
            <select
              value={tcPeriod}
              onChange={(e) => setTcPeriod(e.target.value as "year" | "month")}
              className={field}
            >
              <option value="year">Per year</option>
              <option value="month">Per month</option>
            </select>
          </label>
        </details>
      </section>

      {/* ── 3. Benefits ───────────────────────────────────────────────────── */}
      <section className="grid gap-3">
        <div>
          <h2 className="m-0 text-lg">What else comes with it</h2>
          <p className="m-0 mt-1 text-sm text-fg-2">
            Tick only what the role actually has. These are shown as claims on the listing.
          </p>
        </div>

        {GROUP_ORDER.map((group) => (
          <fieldset key={group} className="border-0 p-0">
            <legend className="mb-1.5 text-sm font-medium text-fg-2">
              {BENEFIT_GROUP_LABEL[group]}
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {BENEFITS.filter((b) => b.group === group).map((b) => (
                <label key={b.key} className="flex items-start gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    checked={benefits.includes(b.key)}
                    onChange={() => toggleBenefit(b.key)}
                    className="mt-1"
                  />
                  <span>
                    {b.label}
                    {b.hint ? (
                      <span className="block text-xs text-fg-2">{b.hint}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      {/* ── 4. How to apply ───────────────────────────────────────────────── */}
      <section className="grid gap-3">
        <h2 className="m-0 text-lg">How to apply</h2>
        <label className="grid gap-1.5">
          <span className="font-medium">
            Apply link or email address
            <Req />
          </span>
          <input
            required
            value={applyTo}
            onChange={(e) => setApplyTo(e.target.value)}
            placeholder="https://yourcompany.com/careers/… or jobs@yourcompany.com"
            className={field}
            dir="ltr"
          />
          <span className="text-xs text-fg-2">
            Applications go straight to you — we never sit in the middle and never see a CV sent
            this way.
            {plan === "free" ? (
              <>
                {" "}
                On a free listing this must be on your own company&rsquo;s domain.
              </>
            ) : null}
          </span>
        </label>

        {/*
          Asked for by a recruiter already receiving CVs here who could not tell
          which listing each one answered. Optional, and last in the section,
          because most people posting one job do not need it and a required
          reference number would be a barrier in front of the free tier.

          Free text, not a number: real ones are "R-2291", "2026/44", "REQ 118".
        */}
        <label className="grid gap-1.5">
          <span className="font-medium">
            Job number <span className="font-normal text-fg-2">(optional)</span>
          </span>
          <input
            value={applyRef}
            onChange={(e) => setApplyRef(e.target.value.slice(0, 40))}
            maxLength={40}
            placeholder="R-2291"
            className={field}
            dir="ltr"
          />
          <span className="text-xs text-fg-2">
            Your own reference for this role. We show it next to the apply button and ask
            applicants to put it in the subject line
            {applyTo.includes("@") ? (
              <> — and since you gave an email address, we fill the subject in for them</>
            ) : null}
            .
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <Button type="button" size="lg" onClick={goToStep2} disabled={!step1Ready}>
          Continue
        </Button>
        <span className="text-sm text-fg-2">
          {step1Ready ? "Next: choose how long it runs." : "Fill in the fields marked * to continue."}
        </span>
      </div>
      </div>

      <div className={step === 2 ? "grid gap-8" : "hidden"}>
      {/* ── 5. How long ───────────────────────────────────────────────────── */}
      <section className="grid gap-3">
        <div>
          <h2 className="m-0 text-lg">How long should it run?</h2>
          <p className="m-0 mt-1 text-sm text-fg-2">
            Every listing closes itself at the end. That is deliberate: a board full of roles that
            were filled months ago is the thing job seekers hate most, and it is why this one is
            worth posting to.
          </p>
        </div>

        <div className="grid gap-2">
          {kind === "employer" ? (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-card border p-3 ${
                plan === "free" ? "border-action bg-accent-tint" : "border-line bg-surface"
              }`}
            >
              <input
                type="radio"
                name="lifespan"
                checked={plan === "free"}
                onChange={() => {
                  setPlan("free");
                  setDays(FREE_DAYS);
                }}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{FREE_DAYS} days</span>
                  <span className="font-bold text-action-text">Free</span>
                </span>
                <span className="mt-0.5 block text-sm text-fg-2">
                  Appears in search like any other listing. Checked automatically and published
                  straight away.
                </span>
              </span>
            </label>
          ) : null}

          {PACKAGES.map((d) => {
            const selected = plan === "sponsored" && days === d;
            return (
              <label
                key={d}
                className={`flex cursor-pointer items-start gap-3 rounded-card border p-3 ${
                  selected ? "border-action bg-accent-tint" : "border-line bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="lifespan"
                  checked={selected}
                  onChange={() => {
                    setPlan("sponsored");
                    setDays(d);
                  }}
                  className="mt-1"
                />
                <span className="flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{d} days</span>
                    <span className="numeral font-bold">
                      {formatUsd(priceUsd(d))}{" "}
                      <span className="font-normal text-fg-2">
                        · ${pricePerDayUsd(d).toFixed(2)}/day
                      </span>
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-fg-2">
                    Includes a labelled slot in the Sponsored strip on the home page and on
                    matching searches. Goes live as soon as it is paid for.
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── 6. Confirm and publish ────────────────────────────────────────── */}
      <section className="grid gap-4 border-t border-line pt-6">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm text-fg-2">
            This is a real, currently open role in Israel, the salary above is what it pays, and I
            am authorised to post it.
          </span>
        </label>

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-control bg-warn-tint px-3 py-2 text-sm text-warn-text"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="lg" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button type="submit" size="lg" disabled={busy || !ready}>
            {busy ? <Spinner className="me-2" /> : null}
            {busy
              ? "Saving…"
              : editing
                ? "Save changes"
                : plan === "free"
                  ? `Publish free for ${FREE_DAYS} days`
                  : `Promote for ${days} days — ${formatUsd(price)}`}
          </Button>

          {/*
            The upsell, and only where it is useful: beside the free option,
            naming the price rather than nagging. One click swaps the length.
          */}
          {plan === "free" && !editing ? (
            <button
              type="button"
              onClick={() => {
                setPlan("sponsored");
                setDays(PACKAGES[1]);
              }}
              className="text-sm font-medium text-action-text underline underline-offset-4"
            >
              or promote it for {PACKAGES[1]} days — {formatUsd(priceUsd(PACKAGES[1]))}
            </button>
          ) : null}
        </div>

        <p className="m-0 text-xs text-fg-2">
          {plan === "free"
            ? "You can edit or close it at any time from your dashboard."
            : "Nothing is charged here. We review the listing, then send an invoice; it goes live once both are done. You can edit it at any time."}
        </p>
      </section>
      </div>
    </form>
  );
}

/** Mirrors SALARY_PROBLEM_TEXT, kept here so the copy can differ in context. */
function salaryProblemText(problem: string | null): string {
  switch (problem) {
    case "not_a_number":
      return "Enter the salary as numbers.";
    case "below_minimum":
      return `That is below ₪${SALARY_MIN_ILS.toLocaleString("en-IL")} a month. This field is monthly gross base — state the monthly equivalent if the role is part-time.`;
    case "above_maximum":
      return `That is above ₪${SALARY_MAX_ILS.toLocaleString("en-IL")} a month. This field is monthly, not annual.`;
    case "inverted":
      return "The top of the range is lower than the bottom.";
    default:
      return "Add the salary range.";
  }
}
