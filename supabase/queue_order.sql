-- BLP Store Map — hand-set queue order + manual additions for the map's
-- queue boxes (Keytop Q · Refinish Q · Plate Q). Karmel 9/18. Run once in the
-- Supabase SQL editor (project ismacawxfvvllfinibbf, same as the task board).
--
-- One row per queue. `ord` is the serials in the order a manager dragged
-- them into; anything not listed keeps its natural order after them.
-- `manual` is pianos added with the ＋ button that the queue's own data
-- (keytop / plate status, refinishing sheet) wouldn't have included.

create table if not exists queue_order (
  queue text primary key,                   -- keytop | refin | plates
  ord jsonb not null default '[]',          -- ["135453", "289994", …]
  manual jsonb not null default '[]',       -- [{"serial":"…","by":"Karmel","at":"2026-09-18T…"}]
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

alter table queue_order enable row level security;
-- reads with the publishable key (the app gates its UI behind Google sign-in);
-- writes ONLY through the service-role key held by the Netlify function,
-- which also checks the writer is an owner / manager / admin
create policy queue_order_read on queue_order for select using (true);
