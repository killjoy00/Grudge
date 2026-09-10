-- Allow the pipeline to replace only its reproducible historical regular-season score layer.
-- app_pipeline is a BYPASSRLS ingestion role, so the table grant is the operative permission.
-- No DELETE grant is added to immutable model results, corrections, live mirror tables, or app roles.
begin;
grant delete on public.player_week_scores to app_pipeline;
commit;
