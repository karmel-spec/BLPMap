-- BLP Store Map task board (speed step 5) — run once in the Supabase SQL editor.
-- Mirrors the "Task Boards" / "Board Columns" sheet tabs; the sheet stays as
-- a mirror (written asynchronously by the write proxy) so reports/history
-- and the bridge notifications keep working unchanged.

create table if not exists tb_cards (
  id text primary key,
  owner text not null default '',
  col text not null default 'todo',
  text text not null default '',
  serial text not null default '',
  due text not null default '',
  from_who text not null default '',
  created timestamptz not null default now(),
  done_at timestamptz,
  ord double precision,
  notes text not null default '',
  snooze text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists tb_cards_owner on tb_cards (owner);
create index if not exists tb_cards_col on tb_cards (col);

create table if not exists tb_cols (
  owner text primary key,
  cols jsonb not null default '[]'
);

alter table tb_cards enable row level security;
alter table tb_cols enable row level security;
-- reads for everyone with the anon key (the app gates its own UI);
-- writes ONLY through the service-role key (the Netlify write proxy)
create policy tb_cards_read on tb_cards for select using (true);
create policy tb_cols_read on tb_cols for select using (true);

-- realtime: broadcast row changes so open boards update live
alter publication supabase_realtime add table tb_cards;
