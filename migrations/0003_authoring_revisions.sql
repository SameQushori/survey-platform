ALTER TABLE assessment_versions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE assessment_versions ADD COLUMN draft_json TEXT;

CREATE INDEX idx_versions_draft_revision
  ON assessment_versions(assessment_id, state, revision);

PRAGMA optimize;
