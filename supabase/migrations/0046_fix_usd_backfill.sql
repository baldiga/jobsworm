-- 0046_fix_usd_backfill.sql — 0045 renamed the column and left the value alone.
--
-- The conversion in 0045 was guarded by `price_usd > 200`, on the reasoning
-- that a shekel-scale figure would be the large one. It is not: the only
-- campaign on the system was a 7-day listing at ₪133, comfortably under the
-- threshold, so it kept a shekel number in a column that now says dollars —
-- which is precisely the confusion the rename existed to end.
--
-- The guard was the mistake, not the threshold. A heuristic about magnitude is
-- guessing; `days` and `plan` are known, and `price_usd(days)` is the exact
-- answer. This recomputes rather than converts.
--
-- Only unpaid campaigns are touched. A paid one records what somebody was
-- actually charged, and no later change of pricing or currency may rewrite
-- that — it is the receipt.

update campaigns
   set price_usd = case when plan = 'free' then 0 else price_usd(days) end,
       price_per_day_usd = case
                             when plan = 'free' or days = 0 then 0
                             else round(price_usd(days) / days, 2)
                           end
 where paid_at is null;

do $check$
declare
  bad int;
begin
  select count(*) into bad
    from campaigns
   where paid_at is null
     and price_usd is distinct from (case when plan = 'free' then 0 else price_usd(days) end);
  assert bad = 0, bad || ' unpaid campaign(s) still disagree with price_usd(days)';
end
$check$;
