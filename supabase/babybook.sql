-- Myles's baby book (Brigham 10/12). Run once in the Supabase SQL editor
-- (project ismacawxfvvllfinibbf, same as the queue boxes and the task board).
--
-- The birth story itself ships with the app (babybook/story.js). These
-- tables hold what Abby adds or changes from her phone: new chapters, new
-- moments, edits to the shipped moments (same id, DB row wins), and the
-- photos attached to each. Photos live in the public `babybook` storage
-- bucket; rows only keep their URLs.
--
-- Reads and writes both go through the Netlify function (/api/babybook)
-- with the service-role key, gated by the family passphrase (BABYBOOK_PIN
-- env var), so no policies open these tables to the publishable key.

create table if not exists babybook_chapters (
  id text primary key,
  title text not null default '',
  subtitle text not null default '',
  big text not null default '',          -- the large numeral/date on the chapter opener ("4:51", "Oct 12")
  sort numeric not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists babybook_entries (
  id text primary key,
  chapter text not null default '',
  time_label text not null default '',   -- "4:51 AM", "Oct 12"
  sort numeric not null default 0,
  kind text not null default 'moment',   -- moment | quote | photos
  title text not null default '',
  body text not null default '',
  cite text not null default '',         -- quote pages: who said it, when
  photos jsonb not null default '[]',    -- [{url, caption}]
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table babybook_chapters enable row level security;
alter table babybook_entries enable row level security;

-- photos: public-read bucket, written only by the function
insert into storage.buckets (id, name, public)
  values ('babybook', 'babybook', true)
  on conflict (id) do nothing;
