-- Proof of Real — Supabase (Postgres) registry schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Access model: the app talks to this table ONLY from the server with the
-- service-role key. RLS is enabled with no policies, so the anon/public key
-- can read nothing.

create table if not exists registrations (
  id           text primary key,
  content_hash text not null,
  phash        text not null,
  -- LSH band pointers ("<i>:<hex>"); overlap query replaces a table scan,
  -- mirroring the DynamoDB BAND# item design.
  bands        text[] not null,
  created_at   timestamptz not null,
  -- Full sealed Registration record, verbatim.
  record       jsonb not null
);

create index if not exists registrations_content_hash_idx
  on registrations (content_hash);
create index if not exists registrations_bands_idx
  on registrations using gin (bands);
create index if not exists registrations_created_at_idx
  on registrations (created_at desc);

alter table registrations enable row level security;
