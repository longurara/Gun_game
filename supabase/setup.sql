-- LASTLIGHT: accounts, friends and player stats.
--
-- Run this ONCE in the Supabase dashboard: SQL Editor -> New query -> paste -> Run. Running it again is harmless.
-- (The game's browser code only ever uses the publishable key: everything below is protected by row level security.)
--
-- What it creates
--   profiles     one row per account, made automatically when somebody registers (username + stats).
--   friendships  friend requests and friends. Only the two people involved can see or change a row.
--   functions    username_available(name), record_match(won, kills, rank).

-- ---------------------------------------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  matches integer not null default 0,
  wins integer not null default 0,
  kills integer not null default 0,
  best_rank integer,
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
grant select on public.profiles to authenticated;

-- Signed-in players can look each other up (to add friends and read the leaderboard). Nobody can write a profile
-- directly: it is created by the trigger below and its stats only change through record_match().
drop policy if exists "profiles are readable by signed-in players" on public.profiles;
create policy "profiles are readable by signed-in players" on public.profiles
  for select to authenticated using (true);

-- A profile appears when an account is created. The username comes from the sign-up form; if it is taken or invalid
-- a free variation is picked, so sign-up never fails because of it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := regexp_replace(coalesce(trim(new.raw_user_meta_data ->> 'username'), ''), '[^A-Za-z0-9_]', '', 'g');
  candidate text;
begin
  if length(wanted) < 3 then wanted := 'player'; end if;
  wanted := left(wanted, 16);
  candidate := wanted;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    candidate := left(wanted, 11) || '_' || substr(md5(random()::text), 1, 4);
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form say "taken" before anything is sent (works before the visitor has an account).
create or replace function public.username_available(name text) returns boolean
language sql security definer set search_path = public stable as $$
  select name ~ '^[A-Za-z0-9_]{3,16}$' and not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- The only way stats change: the signed-in player reports the result of their own match.
create or replace function public.record_match(won boolean, kill_count integer, final_rank integer) returns void
language sql security definer set search_path = public as $$
  update public.profiles set
    matches = matches + 1,
    wins = wins + (case when won then 1 else 0 end),
    kills = kills + greatest(0, least(coalesce(kill_count, 0), 100)),
    best_rank = case when final_rank is null or final_rank < 1 then best_rank when best_rank is null then final_rank else least(best_rank, final_rank) end
  where id = auth.uid();
$$;
revoke all on function public.record_match(boolean, integer, integer) from public, anon;
grant execute on function public.record_match(boolean, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  constraint friendships_not_self check (requester <> addressee)
);
-- One row per pair of people, whoever asked first.
create unique index if not exists friendships_pair_key on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;
revoke all on public.friendships from anon;
grant select, insert, delete on public.friendships to authenticated;
-- Accepting changes the status and nothing else (otherwise the person asked could rewrite who asked them).
grant update (status) on public.friendships to authenticated;

drop policy if exists "see your own friendships" on public.friendships;
create policy "see your own friendships" on public.friendships
  for select to authenticated using (auth.uid() in (requester, addressee));

-- You can only ask on your own behalf, and a new request always starts as pending.
drop policy if exists "send a friend request" on public.friendships;
create policy "send a friend request" on public.friendships
  for insert to authenticated with check (requester = auth.uid() and status = 'pending');

-- Only the person who was asked can accept.
drop policy if exists "accept a friend request" on public.friendships;
create policy "accept a friend request" on public.friendships
  for update to authenticated using (addressee = auth.uid() and status = 'pending') with check (addressee = auth.uid() and status = 'accepted');

-- Either side can decline, cancel or unfriend.
drop policy if exists "end a friendship" on public.friendships;
create policy "end a friendship" on public.friendships
  for delete to authenticated using (auth.uid() in (requester, addressee));
