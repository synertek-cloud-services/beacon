-- File upload/download for Web Remote sessions, matching the toolbar
-- icon -> Upload/Download choice -> file picker flow described directly
-- from real Datto RMM usage. Upload always lands on the logged-on
-- target user's Desktop (no destination picker needed); Download needs a
-- remote directory browser, since there's no other way for a technician
-- to know what files exist on a machine they aren't physically at.
--
-- One table, three request "type"s (browse/download/upload), rather than
-- three tables -- all three share the same "technician requests something,
-- the already-running beacon-screenshare.exe helper polls for it and
-- reports a result" shape (the same assign-then-report pattern this
-- codebase already uses for file_size/ping/process/service Policy checks
-- and, most recently, the Displays switcher's own monitor-switch poll),
-- just with a different request/result JSON shape per type.
--
-- request (JSON): {path} for browse/download; {object_key, filename,
-- size_bytes} for upload (already uploaded to R2 by the dashboard before
-- this row exists, so the helper knows what to fetch).
-- result (JSON, nullable until completed): {entries:[{name,is_dir,
-- size_bytes,modified_at}]} for browse; {object_key, filename,
-- size_bytes} for download (the helper's own upload into R2, for the
-- dashboard to then stream back to the technician's browser); {} for a
-- successful upload.
CREATE TABLE session_file_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'browse' | 'download' | 'upload'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'failed'
  request TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX session_file_requests_session_idx ON session_file_requests(session_id, created_at);
