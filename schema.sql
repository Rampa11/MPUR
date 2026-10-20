BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('mpur-schema-setup',0));
CREATE TABLE IF NOT EXISTS locations (
 id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('ward','unit')), parent text NOT NULL,
 name text NOT NULL, name_key text NOT NULL, code_key text,
 UNIQUE (kind,parent,name_key), UNIQUE(kind,parent,code_key)
);
CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY, unit text NOT NULL, election text NOT NULL, election_date date NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 1 AND 3), location jsonb NOT NULL,
 registered integer NOT NULL CHECK(registered>=0), accredited integer NOT NULL CHECK(accredited BETWEEN 0 AND registered),
 rejected integer NOT NULL CHECK(rejected>=0), votes jsonb NOT NULL, total integer NOT NULL CHECK(total>=0), winners jsonb NOT NULL,
 file_type text NOT NULL, file_data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(total+rejected<=accredited), UNIQUE(unit,election,election_date,slot)
);
CREATE INDEX IF NOT EXISTS submissions_newest ON submissions(created_at DESC);
CREATE OR REPLACE FUNCTION protect_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Submissions are permanent and cannot be edited or deleted'; END; $$;
DROP TRIGGER IF EXISTS immutable_submission ON submissions;
CREATE TRIGGER immutable_submission BEFORE UPDATE OR DELETE OR TRUNCATE ON submissions FOR EACH STATEMENT EXECUTE FUNCTION protect_submission();
CREATE UNIQUE INDEX IF NOT EXISTS submissions_identity ON submissions(id,unit,election,election_date);
CREATE TABLE IF NOT EXISTS submission_reviews (
 submission_id uuid PRIMARY KEY,
 unit text NOT NULL,election text NOT NULL,election_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 reviewed_by text NOT NULL,reason text NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(submission_id,unit,election,election_date) REFERENCES submissions(id,unit,election,election_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_per_unit ON submission_reviews(unit,election,election_date) WHERE status='approved';
CREATE INDEX IF NOT EXISTS reviews_status ON submission_reviews(status);
CREATE INDEX IF NOT EXISTS submissions_election ON submissions(election,election_date,unit);
CREATE INDEX IF NOT EXISTS submissions_location ON submissions USING gin(location);
CREATE TABLE IF NOT EXISTS review_events (
 id uuid PRIMARY KEY,submission_id uuid NOT NULL REFERENCES submissions(id),
 previous_status text NOT NULL CHECK(previous_status IN ('pending','approved','rejected')),
 status text NOT NULL CHECK(status IN ('pending','approved','rejected')),
 reviewed_by text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_events_submission ON review_events(submission_id,created_at);
DROP TRIGGER IF EXISTS immutable_review_event ON review_events;
CREATE TRIGGER immutable_review_event BEFORE UPDATE OR DELETE OR TRUNCATE ON review_events FOR EACH STATEMENT EXECUTE FUNCTION protect_submission();
COMMIT;
