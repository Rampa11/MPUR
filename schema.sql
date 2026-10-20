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
