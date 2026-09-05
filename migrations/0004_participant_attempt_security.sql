PRAGMA foreign_keys = ON;

ALTER TABLE attempts
  ADD COLUMN completion_reason TEXT
  CHECK (completion_reason IS NULL OR completion_reason IN ('submitted', 'deadline', 'abandoned'));

PRAGMA optimize;
