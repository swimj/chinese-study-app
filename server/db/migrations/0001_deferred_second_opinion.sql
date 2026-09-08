-- Deferred second-opinion provenance. Existing history retains NULL provenance.

ALTER TABLE learner_owned_reflection_generation_runs ADD COLUMN source_proposal_ids_json TEXT;

ALTER TABLE learner_owned_reflection_generation_run_starts ADD COLUMN source_proposal_ids_json TEXT;

DROP VIEW reflection_generation_runs;

CREATE VIEW reflection_generation_runs AS
    SELECT run_id, source_session_id, reflection_flow_version, started_at, completed_at, provider, model, provider_model, prompt_version, response_id, finish_reason, client_request_id, bundle_schema_version, result_schema_version, diagnostic_json, state, failure_code, eligible_item_count, included_item_count, input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_tokens, total_tokens, pricing_snapshot_id, pricing_as_of, pricing_basis_json, estimated_cost_usd, evidence_bundle_json, source_proposal_ids_json
    FROM learner_owned_reflection_generation_runs
    WHERE learner_id = current_learner_id();

CREATE TRIGGER reflection_generation_runs_scoped_delete
    INSTEAD OF DELETE ON reflection_generation_runs
    BEGIN
      DELETE FROM learner_owned_reflection_generation_runs
      WHERE learner_id = current_learner_id() AND run_id = OLD.run_id;
    END;

CREATE TRIGGER reflection_generation_runs_scoped_insert
    INSTEAD OF INSERT ON reflection_generation_runs
    BEGIN
      INSERT INTO learner_owned_reflection_generation_runs (learner_id, run_id, source_session_id, reflection_flow_version, started_at, completed_at, provider, model, provider_model, prompt_version, response_id, finish_reason, client_request_id, bundle_schema_version, result_schema_version, diagnostic_json, state, failure_code, eligible_item_count, included_item_count, input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_tokens, total_tokens, pricing_snapshot_id, pricing_as_of, pricing_basis_json, estimated_cost_usd, evidence_bundle_json, source_proposal_ids_json)
      VALUES (current_learner_id(), NEW.run_id, NEW.source_session_id, NEW.reflection_flow_version, NEW.started_at, NEW.completed_at, NEW.provider, NEW.model, NEW.provider_model, NEW.prompt_version, NEW.response_id, NEW.finish_reason, NEW.client_request_id, NEW.bundle_schema_version, NEW.result_schema_version, NEW.diagnostic_json, NEW.state, NEW.failure_code, NEW.eligible_item_count, NEW.included_item_count, NEW.input_tokens, NEW.cached_input_tokens, NEW.cache_write_input_tokens, NEW.output_tokens, NEW.reasoning_tokens, NEW.total_tokens, NEW.pricing_snapshot_id, NEW.pricing_as_of, NEW.pricing_basis_json, NEW.estimated_cost_usd, NEW.evidence_bundle_json, NEW.source_proposal_ids_json);
    END;

CREATE TRIGGER reflection_generation_runs_scoped_update
    INSTEAD OF UPDATE ON reflection_generation_runs
    BEGIN
      SELECT RAISE(ABORT, 'reflection generation runs are immutable');
    END;

DROP VIEW reflection_generation_run_starts;

CREATE VIEW reflection_generation_run_starts AS
    SELECT run_id, source_session_id, reflection_flow_version, started_at, provider, model, provider_model, prompt_version, client_request_id, eligible_item_count, included_item_count, evidence_bundle_json, source_proposal_ids_json
    FROM learner_owned_reflection_generation_run_starts
    WHERE learner_id = current_learner_id();

CREATE TRIGGER reflection_generation_run_starts_scoped_delete
    INSTEAD OF DELETE ON reflection_generation_run_starts
    BEGIN
      DELETE FROM learner_owned_reflection_generation_run_starts
      WHERE learner_id = current_learner_id() AND run_id = OLD.run_id;
    END;

CREATE TRIGGER reflection_generation_run_starts_scoped_insert
    INSTEAD OF INSERT ON reflection_generation_run_starts
    BEGIN
      INSERT INTO learner_owned_reflection_generation_run_starts (learner_id, run_id, source_session_id, reflection_flow_version, started_at, provider, model, provider_model, prompt_version, client_request_id, eligible_item_count, included_item_count, evidence_bundle_json, source_proposal_ids_json)
      VALUES (current_learner_id(), NEW.run_id, NEW.source_session_id, NEW.reflection_flow_version, NEW.started_at, NEW.provider, NEW.model, NEW.provider_model, NEW.prompt_version, NEW.client_request_id, NEW.eligible_item_count, NEW.included_item_count, NEW.evidence_bundle_json, NEW.source_proposal_ids_json);
    END;

CREATE TRIGGER reflection_generation_run_starts_scoped_update
    INSTEAD OF UPDATE ON reflection_generation_run_starts
    BEGIN
      SELECT RAISE(ABORT, 'reflection generation run starts are immutable');
    END;
