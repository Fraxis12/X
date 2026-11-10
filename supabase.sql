-- Tablas de X. Ejecutar una vez en Supabase → SQL Editor. Se puede correr más de una vez.
-- Cada usuario solo ve y cambia sus propios datos.

create table if not exists public.x_profiles (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  started_at  timestamptz not null default now(),
  reasons     text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

create table if not exists public.x_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('urge', 'relapse')),
  at          timestamptz not null default now(),
  intensity   int  check (intensity between 1 and 5),
  triggers    text[] not null default '{}',
  note        text check (char_length(note) <= 2000),
  created_at  timestamptz not null default now()
);
-- Qué fue: 'porno', 'masturbacion' o las dos.
alter table public.x_events add column if not exists what text[] not null default '{}'
  check (what <@ array['porno', 'masturbacion']::text[]);
create index if not exists x_events_user_at on public.x_events (user_id, at desc);

grant select, insert, update, delete on public.x_profiles, public.x_events to authenticated;
revoke all on public.x_profiles, public.x_events from anon;
alter table public.x_profiles enable row level security;
alter table public.x_events   enable row level security;

drop policy if exists "x_profiles: propio" on public.x_profiles;
drop policy if exists "x_events: propios"  on public.x_events;
create policy "x_profiles: propio" on public.x_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "x_events: propios"  on public.x_events   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';
