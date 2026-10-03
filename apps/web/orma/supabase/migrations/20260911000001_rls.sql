alter table public.profiles enable row level security;
alter table public.consents enable row level security;
alter table public.slots enable row level security;
alter table public.items enable row level security;
alter table public.item_mentions enable row level security;
alter table public.commitments enable row level security;
alter table public.call_runs enable row level security;
alter table public.call_events enable row level security;
alter table public.transcripts enable row level security;
alter table public.results enable row level security;
alter table public.pattern_reports enable row level security;
alter table public.deliveries enable row level security;
alter table public.webhook_events enable row level security;

create policy profiles_owner on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy consents_owner on public.consents
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy slots_owner on public.slots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy items_owner on public.items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy item_mentions_owner on public.item_mentions
  for all
  using (
    exists (
      select 1
      from public.items
      where items.id = item_mentions.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.items
      where items.id = item_mentions.item_id
        and items.user_id = auth.uid()
    )
  );

create policy commitments_owner on public.commitments
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy call_runs_owner_read on public.call_runs
  for select
  using (auth.uid() = user_id);

create policy call_events_owner_read on public.call_events
  for select
  using (
    exists (
      select 1
      from public.call_runs
      where call_runs.id = call_events.call_run_id
        and call_runs.user_id = auth.uid()
    )
  );

create policy transcripts_owner_read on public.transcripts
  for select
  using (
    exists (
      select 1
      from public.call_runs
      where call_runs.id = transcripts.call_run_id
        and call_runs.user_id = auth.uid()
    )
  );

create policy results_owner_read on public.results
  for select
  using (
    exists (
      select 1
      from public.call_runs
      where call_runs.id = results.call_run_id
        and call_runs.user_id = auth.uid()
    )
  );

create policy pattern_reports_owner_read on public.pattern_reports
  for select
  using (auth.uid() = user_id);

create policy deliveries_owner_read on public.deliveries
  for select
  using (auth.uid() = user_id);
