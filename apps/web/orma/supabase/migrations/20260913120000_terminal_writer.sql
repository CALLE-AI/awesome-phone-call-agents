-- T2.5a terminal writer attribution.
--
-- The webhook and the poll both move a run out of a pending state with a
-- guarded UPDATE. Exactly one of them matches. When a writer matches no row it
-- must still learn who moved the run, and no other column can answer that.
--
-- The column is set in the same statement as `state`, so a stored tag always
-- names the write that landed. The webhook writes `webhook:<event_id>` and the
-- poll writes `poll`.
--
-- The run owner may read the column through `call_runs_owner_read`. An event
-- id is a de-duplication key, and it carries no secret and no phone number.
alter table public.call_runs
  add column terminal_writer text;

comment on column public.call_runs.terminal_writer is
  'Names the write that moved this run to a terminal state. The poll writes poll. The webhook writes webhook:<event_id>. A dry dispatch writes dry_run. A dispatcher that fails a stranded run writes dispatch_recovery. A refusal or a rejected dispatch leaves it null.';
