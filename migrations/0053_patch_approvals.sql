-- Fleet-wide patch approval decisions (Patch Management, approval workflow
-- slice). One row per Windows Update, keyed by WUA's own UpdateID GUID --
-- not per device: an admin is deciding whether a specific update is safe to
-- roll out, not re-deciding it machine by machine (matches real-world patch
-- management tooling). No row for a given update_id means undecided/pending
-- -- same "absence = default state" convention as policy_monitors'
-- notify_webhook/notify_email. title/kb_article_ids/severity are a snapshot
-- taken at approval time, purely for display -- the live source of truth for
-- which devices currently have this update pending is still each device's
-- latest audit, not this table.
CREATE TABLE patch_approvals (
  update_id      TEXT PRIMARY KEY,
  status         TEXT NOT NULL, -- 'approved' | 'ignored'
  title          TEXT NOT NULL,
  kb_article_ids TEXT NOT NULL, -- JSON array
  severity       TEXT,
  updated_at     INTEGER NOT NULL
);
