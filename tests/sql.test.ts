/**
 * Runs supabase/setup.sql on a real (in-memory, WebAssembly) Postgres and checks what each kind of user can and cannot
 * do, so the security rules are proven before they are pasted into the real project. Supabase's own pieces (the auth
 * schema, the anon/authenticated roles, auth.uid()) are stubbed the way Supabase defines them.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';

/** Run as a signed-in user (or anonymous), like a request carrying that JWT. */
async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role;'); }
}
const fails = async (user: string | null, sql: string, params: unknown[] = []) => { try { await as(user, sql, params); return false; } catch { return true; } };

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(readFileSync('supabase/setup.sql', 'utf8'));
  await db.exec(readFileSync('supabase/setup.sql', 'utf8')); // running it twice must be harmless
  const signUp = (id: string, username: string | null) => db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, `${id}@x.test`, JSON.stringify(username === null ? {} : { username })]);
  await signUp(A, 'Hana'); await signUp(B, 'Minh'); await signUp(C, 'Lan');
});

test('registering creates a profile with the chosen username; clashes, bad characters and short names are fixed up rather than failing', async () => {
  const names = (await db.query<{ username: string }>('select username from public.profiles order by created_at, username')).rows.map(r => r.username).sort();
  assert.deepEqual(names, ['Hana', 'Lan', 'Minh']);
  const extra = async (id: string, name: string | null) => { await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, `${id}@x.test`, JSON.stringify(name === null ? {} : { username: name })]); return (await db.query<{ username: string }>('select username from public.profiles where id = $1', [id])).rows[0].username; };
  const second = await extra('00000000-0000-4000-8000-0000000000d1', 'hana');
  assert.match(second, /^hana_[0-9a-f]{4}$/, 'a name that differs only by case is taken');
  assert.equal(await extra('00000000-0000-4000-8000-0000000000d2', 'a b!'), 'player', 'too short once cleaned');
  assert.equal(await extra('00000000-0000-4000-8000-0000000000d3', null), 'player_' + (await db.query<{ u: string }>("select username as u from public.profiles where id = '00000000-0000-4000-8000-0000000000d3'")).rows[0].u.slice(7), 'no username given');
  assert.equal(await extra('00000000-0000-4000-8000-0000000000d4', 'X'.repeat(40)), 'X'.repeat(16), 'long names are cut');
  assert.equal(await extra('00000000-0000-4000-8000-0000000000d5', 'Tên Tiếng_Việt9'), 'TnTing_Vit9', 'accents and spaces are dropped, underscores kept');
  await db.query("delete from auth.users where id::text like '00000000-0000-4000-8000-0000000000d%'");
});

test('username_available works before sign-in, ignores case and rejects invalid names', async () => {
  assert.deepEqual(await as(null, "select public.username_available('Hana') as ok"), [{ ok: false }]);
  assert.deepEqual(await as(null, "select public.username_available('HANA') as ok"), [{ ok: false }]);
  assert.deepEqual(await as(null, "select public.username_available('Fresh_Name') as ok"), [{ ok: true }]);
  assert.deepEqual(await as(null, "select public.username_available('no') as ok"), [{ ok: false }]);
  assert.deepEqual(await as(null, "select public.username_available('bad name') as ok"), [{ ok: false }]);
});

test('profiles: signed-in players can read them all; anonymous visitors cannot; nobody can write one directly', async () => {
  assert.equal((await as(A, 'select * from public.profiles')).length, 3);
  assert.equal(await fails(null, 'select * from public.profiles'), true, 'anon is refused');
  assert.equal(await fails(A, "insert into public.profiles (id, username) values (gen_random_uuid(), 'Sneaky')"), true);
  assert.deepEqual(await as(A, "update public.profiles set wins = 999 where id = $1 returning id", [A]).catch(() => 'refused'), 'refused', 'stats cannot be edited directly');
  assert.equal(await fails(A, 'delete from public.profiles where id = $1', [B]), true);
  assert.equal((await db.query<{ wins: number }>('select wins from public.profiles where id = $1', [A])).rows[0].wins, 0);
});

test('friends: ask, be asked, accept; only the right person can do each step', async () => {
  // A asks B.
  assert.equal((await as(A, "insert into public.friendships (requester, addressee) values ($1, $2) returning id", [A, B])).length, 1);
  assert.equal(await fails(A, "insert into public.friendships (requester, addressee) values ($1, $2)", [B, C]), true, 'cannot ask on somebody else\'s behalf');
  assert.equal(await fails(A, "insert into public.friendships (requester, addressee, status) values ($1, $2, 'accepted')", [A, C]), true, 'cannot make yourself a friend');
  assert.equal(await fails(A, 'insert into public.friendships (requester, addressee) values ($1, $1)', [A]), true, 'not with yourself');
  assert.equal(await fails(B, 'insert into public.friendships (requester, addressee) values ($1, $2)', [B, A]), true, 'no second row for the same pair, whoever asks');
  // Who sees what.
  assert.equal((await as(B, 'select * from public.friendships')).length, 1);
  assert.equal((await as(A, 'select * from public.friendships')).length, 1);
  assert.equal((await as(C, 'select * from public.friendships')).length, 0, 'a stranger sees nothing');
  assert.equal(await fails(null, 'select * from public.friendships'), true);
  // Accepting: not by the asker, not by a stranger, not by rewriting the row.
  assert.equal((await as(A, "update public.friendships set status = 'accepted' where requester = $1 returning id", [A])).length, 0, 'the asker cannot accept their own request');
  assert.equal((await as(C, "update public.friendships set status = 'accepted' where requester = $1 returning id", [A])).length, 0);
  assert.equal(await fails(B, 'update public.friendships set requester = $1 where addressee = $2', [C, B]), true, 'only the status column may change');
  assert.equal((await as(B, "update public.friendships set status = 'accepted' where requester = $1 returning id, status", [A])).length, 1);
  assert.equal((await db.query<{ status: string }>('select status from public.friendships')).rows[0].status, 'accepted');
  // An accepted friendship cannot be "accepted" again or downgraded.
  assert.equal((await as(B, "update public.friendships set status = 'pending' where addressee = $1 returning id", [B])).length, 0, 'an accepted friendship cannot be changed back');
  assert.equal((await db.query<{ status: string }>('select status from public.friendships')).rows[0].status, 'accepted');
});

test('friends: either side can end it, a stranger cannot, declined requests can be asked again', async () => {
  assert.equal((await as(C, 'delete from public.friendships where requester = $1 returning id', [A])).length, 0, 'a stranger deletes nothing');
  assert.equal((await as(A, 'delete from public.friendships where requester = $1 returning id', [A])).length, 1, 'the asker can unfriend');
  assert.equal((await as(C, 'insert into public.friendships (requester, addressee) values ($1, $2) returning id', [C, A])).length, 1);
  assert.equal((await as(A, 'delete from public.friendships where addressee = $1 returning id', [A])).length, 1, 'the asked can decline');
  assert.equal((await as(B, 'select * from public.friendships')).length, 0);
  assert.equal((await as(A, 'insert into public.friendships (requester, addressee) values ($1, $2) returning id', [A, C])).length, 1, 'asking again after a decline works');
});

test('record_match changes only the caller\'s own stats, clamps kills, keeps the best rank, and is closed to anonymous callers', async () => {
  await as(A, 'select public.record_match(true, 7, 1)');
  await as(A, 'select public.record_match(false, 3, 5)');
  await as(A, 'select public.record_match(false, 100000, 0)');
  await as(B, 'select public.record_match(false, 2, 40)');
  const rows = (await db.query<{ username: string; matches: number; wins: number; kills: number; best_rank: number | null }>("select username, matches, wins, kills, best_rank from public.profiles where id in ($1, $2, $3) order by username", [A, B, C])).rows;
  assert.deepEqual(rows.find(r => r.username === 'Hana'), { username: 'Hana', matches: 3, wins: 1, kills: 110, best_rank: 1 });
  assert.deepEqual(rows.find(r => r.username === 'Minh'), { username: 'Minh', matches: 1, wins: 0, kills: 2, best_rank: 40 });
  assert.deepEqual(rows.find(r => r.username === 'Lan'), { username: 'Lan', matches: 0, wins: 0, kills: 0, best_rank: null });
  assert.equal(await fails(null, 'select public.record_match(true, 1, 1)'), true, 'anonymous callers cannot report results');
});

test('the leaderboard query works for signed-in players, and deleting an account removes its profile and friendships', async () => {
  const top = await as<{ username: string; wins: number }>(B, 'select username, wins from public.profiles order by wins desc, kills desc limit 3');
  assert.equal(top[0].username, 'Hana');
  await db.query("delete from auth.users where id = $1", [C]);
  assert.equal((await db.query('select * from public.profiles where id = $1', [C])).rows.length, 0);
  assert.equal((await db.query('select * from public.friendships where requester = $1 or addressee = $1', [C])).rows.length, 0);
});
