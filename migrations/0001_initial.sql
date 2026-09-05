PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  auth_subject TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  platform_role TEXT CHECK (platform_role IS NULL OR platform_role = 'super_admin'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role = 'organizer'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE assessment_versions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 60 AND 86400),
  content_hash TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  UNIQUE (assessment_id, version_number),
  CHECK ((state = 'draft' AND published_at IS NULL) OR (state = 'published' AND published_at IS NOT NULL))
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  assessment_version_id TEXT NOT NULL REFERENCES assessment_versions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('single_choice', 'multiple_choice', 'rating')),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 199),
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  is_scored INTEGER NOT NULL DEFAULT 0 CHECK (is_scored IN (0, 1)),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 100),
  scale_min INTEGER,
  scale_max INTEGER,
  scale_min_label TEXT CHECK (scale_min_label IS NULL OR length(scale_min_label) <= 100),
  scale_max_label TEXT CHECK (scale_max_label IS NULL OR length(scale_max_label) <= 100),
  UNIQUE (assessment_version_id, position),
  CHECK (
    (type IN ('single_choice', 'multiple_choice') AND scale_min IS NULL AND scale_max IS NULL)
    OR
    (type = 'rating' AND is_scored = 0 AND points = 0 AND scale_min IS NOT NULL AND scale_max > scale_min)
  ),
  CHECK ((is_scored = 1 AND points BETWEEN 1 AND 100) OR (is_scored = 0 AND points = 0))
);

CREATE TABLE question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
  is_correct INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  UNIQUE (question_id, position)
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  assessment_version_id TEXT NOT NULL UNIQUE REFERENCES assessment_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'closed', 'archived')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('open', 'controlled')),
  open_repeat_policy TEXT CHECK (open_repeat_policy IN ('unlimited', 'best_effort_once')),
  code_digest TEXT UNIQUE,
  code_hint TEXT,
  show_participant_result INTEGER NOT NULL DEFAULT 0 CHECK (show_participant_result IN (0, 1)),
  opens_at INTEGER,
  closes_at INTEGER,
  published_at INTEGER NOT NULL,
  closed_at INTEGER,
  CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
  CHECK (
    (access_mode = 'open' AND open_repeat_policy IS NOT NULL AND code_digest IS NOT NULL)
    OR
    (access_mode = 'controlled' AND open_repeat_policy IS NULL AND code_digest IS NULL)
  )
);

CREATE TABLE participant_invitations (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
  token_digest TEXT NOT NULL UNIQUE,
  participant_label TEXT NOT NULL CHECK (length(participant_label) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
  assessment_version_id TEXT NOT NULL REFERENCES assessment_versions(id) ON DELETE RESTRICT,
  invitation_id TEXT UNIQUE REFERENCES participant_invitations(id) ON DELETE RESTRICT,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('open', 'controlled')),
  participant_identity_digest TEXT,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired')),
  token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version >= 1),
  started_at INTEGER NOT NULL,
  deadline_at INTEGER,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (deadline_at IS NULL OR deadline_at > started_at),
  CHECK (
    (access_mode = 'open' AND invitation_id IS NULL)
    OR
    (access_mode = 'controlled' AND invitation_id IS NOT NULL AND participant_identity_digest IS NULL)
  ),
  CHECK (
    (status = 'submitted' AND submitted_at IS NOT NULL)
    OR
    (status IN ('active', 'expired') AND submitted_at IS NULL)
  )
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('choice', 'rating', 'empty')),
  rating_value INTEGER,
  answered_at INTEGER NOT NULL,
  UNIQUE (attempt_id, question_id),
  CHECK (
    (value_kind = 'rating' AND rating_value IS NOT NULL)
    OR
    (value_kind IN ('choice', 'empty') AND rating_value IS NULL)
  )
);

CREATE TABLE answer_options (
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES question_options(id) ON DELETE RESTRICT,
  PRIMARY KEY (answer_id, option_id)
);

CREATE TABLE results (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score >= 0),
  max_score INTEGER NOT NULL CHECK (max_score >= 0),
  calculated_at INTEGER NOT NULL,
  CHECK (score <= max_score)
);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 100),
  key_digest TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (scope, key_digest),
  CHECK (expires_at > created_at)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 100),
  entity_id TEXT,
  request_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_memberships_user_status ON memberships(user_id, status);
CREATE INDEX idx_assessments_org_status_updated ON assessments(organization_id, status, updated_at DESC);
CREATE INDEX idx_versions_assessment_state ON assessment_versions(assessment_id, state);
CREATE UNIQUE INDEX idx_versions_one_draft ON assessment_versions(assessment_id) WHERE state = 'draft';
CREATE INDEX idx_questions_version_position ON questions(assessment_version_id, position);
CREATE INDEX idx_options_question_position ON question_options(question_id, position);
CREATE INDEX idx_publications_assessment_status ON publications(assessment_id, status);
CREATE UNIQUE INDEX idx_publications_one_live ON publications(assessment_id) WHERE status = 'published';
CREATE INDEX idx_invitations_publication_status ON participant_invitations(publication_id, status);
CREATE INDEX idx_attempts_publication_status_started ON attempts(publication_id, status, started_at DESC);
CREATE UNIQUE INDEX idx_attempts_open_identity_once
  ON attempts(publication_id, participant_identity_digest)
  WHERE participant_identity_digest IS NOT NULL;
CREATE INDEX idx_answers_attempt ON answers(attempt_id);
CREATE INDEX idx_audit_org_created ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);

PRAGMA optimize;
