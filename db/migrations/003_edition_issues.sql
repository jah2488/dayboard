-- Sweep health: capture connector/fetch problems per edition so the dashboard
-- can show an alert panel ("Calendar unreachable", "GitHub auth failed", etc.).
-- JSON array of {source, message}; NULL/absent = no issues recorded.
ALTER TABLE editions ADD COLUMN issues TEXT;
