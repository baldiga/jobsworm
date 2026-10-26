-- 0048_withdraw_my_campaign.sql — let a recruiter take down their own listing,
-- including one they have paid for.
--
-- `cancel_my_campaign` refused anything paid, on the reasoning that ending a
-- paid campaign early is a refund conversation and not a button a buyer
-- presses at 2am. That reasoning protected the wrong thing.
--
-- The commonest reason to take a listing down is that the role was filled. A
-- product whose entire pitch is "we fight ghost jobs" cannot be the thing
-- standing between an employer and taking down a filled vacancy — least of all
-- for the employers who paid, whose ads are the most prominent on the site.
-- Every hour that listing stays up, someone writes an application nobody will
-- read.
--
-- Money and visibility are separated instead. This ends the listing; it makes
-- no refund and pretends to none. Days already served were delivered, and a
-- refund for unused days stays a decision a person makes, through
-- `refund_campaign`. The UI says so before the click rather than after it.
--
-- One function rather than two, because the caller must not be the one
-- deciding which case it is. The web route reaches campaigns only through
-- RPCs — `campaigns` has RLS on and no policies — so it cannot read `paid_at`
-- to choose, and a route that guessed would eventually guess wrong. The
-- decision is made here, next to the row, under a lock.

create or replace function withdraw_my_campaign(p_campaign_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c campaigns;
begin
  select * into c from campaigns
   where id = p_campaign_id and recruiter_id = auth.uid()
   for update;

  -- Deliberately the same error as somebody else's campaign: "not yours" and
  -- "does not exist" must be indistinguishable from outside.
  if not found then
    raise exception 'campaign not found';
  end if;

  -- Already gone. Idempotent rather than an error: a double click, a retried
  -- request and a second tab are all this, and none of them is a problem.
  if c.status in ('ended', 'cancelled', 'refunded') then
    return c.status;
  end if;

  if c.paid_at is null then
    /*
     * Never paid for, so nothing ran and nothing is owed. The job goes back to
     * draft rather than closed — it was never public, and `closed` would put a
     * listing into the closed-jobs statistics that was never open.
     */
    update campaigns set status = 'cancelled' where id = c.id;
    if c.job_id is not null then
      update jobs set status = 'draft', sponsored_until = null where id = c.job_id;
    end if;
    return 'cancelled';
  end if;

  /*
   * Paid, so it ran. `ended` and a closed job, exactly as the clock would have
   * left it at `ends_at` — this is the same ending, brought forward.
   *
   * `ends_at = now()` matters beyond tidiness: `days_left` is computed from it,
   * and leaving the original date would keep telling the recruiter their
   * finished listing has four days to run.
   */
  update campaigns set status = 'ended', ends_at = now() where id = c.id;
  if c.job_id is not null then
    update jobs
       set status = 'closed', closed_at = now(), sponsored_until = null
     where id = c.job_id;
  end if;
  return 'ended';
end;
$fn$;

grant execute on function withdraw_my_campaign(uuid) to authenticated;

-- `cancel_my_campaign` is left in place and still refuses paid campaigns.
-- Nothing calls it now, but it is granted to `authenticated`, so dropping it
-- would break any session still holding the old client bundle.

do $check$
begin
  assert (select prosecdef from pg_proc where proname = 'withdraw_my_campaign'),
    'withdraw_my_campaign must be SECURITY DEFINER';
  -- The ownership predicate is the only thing standing between a recruiter and
  -- everybody else's listings, so its presence is asserted, not assumed.
  assert (select pg_get_functiondef(oid) like '%auth.uid()%'
            from pg_proc where proname = 'withdraw_my_campaign'),
    'withdraw_my_campaign lost its auth.uid() filter';
end
$check$;
