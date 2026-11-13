-- Users API schema (ADR-002 + amendments). Applied by `npm run db:migrate`; every statement is safe to re-run.

create table if not exists users (
  id         uuid primary key,
  email      text not null,
  name       text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint users_email_normalized check (email = lower(btrim(email)))
);

create unique index if not exists users_email_key on users (email);

-- Keyset pagination: newest first, id breaks same-millisecond ties.
create index if not exists users_created_idx on users (created_at desc, id desc);

create table if not exists idempotency_keys (
  key          text primary key,
  request_hash text not null,                       -- sha256 of the normalized create body
  user_id      uuid not null references users(id) on delete cascade,
  response     jsonb not null,                      -- the 201 body as first sent (includes the email): kept 24h only
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null                 -- now() + 24h; expired rows are ignored and purged on every create
);

-- Purge-on-create scans expired rows by this index.
create index if not exists idempotency_keys_expires_idx on idempotency_keys (expires_at);

-- Databases created before the cascade existed: re-create the FK so deleting a user also deletes its key rows (erasure).
alter table idempotency_keys drop constraint if exists idempotency_keys_user_id_fkey;
alter table idempotency_keys
  add constraint idempotency_keys_user_id_fkey foreign key (user_id) references users(id) on delete cascade;
