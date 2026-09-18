-- BLP Store Map — agent chat history (Karmel 9/18). Run once in the Supabase
-- SQL editor (project ismacawxfvvllfinibbf, same one the task board uses).
-- Every message exchanged with a Hermes agent from the store map's chat
-- windows lands here, so threads survive browsers/devices and are searchable.

create table if not exists agent_messages (
  id bigserial primary key,
  agent text not null,                      -- lindsay, melody, carla, chris, …
  role text not null check (role in ('user', 'agent')),
  who text not null default '',             -- display name of the person (user rows) or the agent
  who_email text not null default '',       -- signed-in Google account for user rows
  body text not null,
  run_id text,                              -- gateway run id (agent rows), used to de-duplicate
  created_at timestamptz not null default now()
);
create index if not exists agent_messages_agent_time on agent_messages (agent, created_at);
-- one stored reply per gateway run, however many browsers were polling it
-- (user rows carry a null run_id, which the unique index ignores)
create unique index if not exists agent_messages_run on agent_messages (run_id);
-- full-text search across every thread ("what did Melody say about the Steinway?")
create index if not exists agent_messages_fts on agent_messages
  using gin (to_tsvector('english', body));

alter table agent_messages enable row level security;
-- reads with the publishable key (the app gates its UI behind Google sign-in);
-- writes ONLY through the service-role key held by the Netlify function
create policy agent_messages_read on agent_messages for select using (true);
