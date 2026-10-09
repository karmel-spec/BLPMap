-- BLP Store Map — 🎵 Showroom Tuning Check marks (Brigham 10/9). Run once in
-- the Supabase SQL editor (project ismacawxfvvllfinibbf, same as the queue
-- boxes and the task board).
--
-- One row per piano Korban has marked on the walk-order worksheet: Good or
-- Needs tuning, plus the service note (sticky key, squeaky pedal, clicks…);
-- or Skipped with the reason (also posted to Chris's thread for review).
-- The app only shows marks from the last 30 days; "Clear marks" deletes
-- every row to start a fresh walk.

create table if not exists tuning_check (
  serial text primary key,                  -- Piano Log serial
  mark text not null default '',            -- good | tune | skip | ''
  note text not null default '',
  priority boolean not null default false,  -- ⚡ ASAP: top of the Tuning Queue (tune marks only)
  marked_by text not null default '',
  marked_at timestamptz not null default now()
);

alter table tuning_check enable row level security;
-- reads with the publishable key (the app gates its UI behind Google sign-in);
-- writes ONLY through the service-role key held by the Netlify function,
-- which verifies the signed-in Google account first
create policy tuning_check_read on tuning_check for select using (true);

-- added 10/9 (⚡ ASAP): run on an existing table
alter table tuning_check add column if not exists priority boolean not null default false;
