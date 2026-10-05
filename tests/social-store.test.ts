import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SocialStore } from '../src/social/store.ts';
import { friendlyError } from '../src/social/api.ts';
import { FakeSocialServer } from './helpers/fake-social.ts';

/** Two (or more) browsers on one fake server, each with its own store. */
function browsers(count = 2, setup?: (server: FakeSocialServer) => void) {
  const server = new FakeSocialServer();
  setup?.(server);
  const stores = Array.from({ length: count }, () => new SocialStore(server.client()));
  return { server, stores };
}
async function signUp(store: SocialStore, name: string) {
  assert.equal(await store.register(name, `${name.toLowerCase()}@example.com`, 'secret1'), true, store.state.message?.text);
  await store.login(`${name.toLowerCase()}@example.com`, 'secret1');
}

test('registering checks the form first, then the username, then creates the account and signs in', async () => {
  const { stores: [store] } = browsers(1);
  await store.start();
  assert.equal(store.state.readiness, 'ok');
  assert.equal(await store.register('ab', 'a@b.co', 'secret1'), false);
  assert.match(store.state.message!.text, /3–16 ký tự/);
  assert.equal(await store.register('Hana', 'not-an-email', 'secret1'), false);
  assert.match(store.state.message!.text, /Email/);
  assert.equal(await store.register('Hana', 'hana@example.com', '123'), false);
  assert.match(store.state.message!.text, /6 ký tự/);
  assert.equal(store.signedIn, false);
  assert.equal(await store.register('Hana', 'hana@example.com', 'secret1'), true);
  assert.equal(store.state.message!.ok, true);
  assert.equal(store.signedIn, true, 'without email confirmation the new account is signed in at once');
  assert.equal(store.displayName, 'Hana');
  assert.equal(store.state.profile?.username, 'Hana');
  assert.equal(store.state.busy, false);
});

test('a taken username or an email already in use is refused with a clear message', async () => {
  const { stores: [first, second] } = browsers();
  await first.start(); await second.start();
  await signUp(first, 'Hana');
  assert.equal(await second.register('hana', 'other@example.com', 'secret1'), false);
  assert.match(second.state.message!.text, /đã có người dùng/);
  assert.equal(await second.register('Minh', 'hana@example.com', 'secret1'), false);
  assert.match(second.state.message!.text, /đã được đăng ký/);
});

test('with email confirmation switched on the player is told to confirm, cannot sign in until they do, and then can', async () => {
  const { server, stores: [store] } = browsers(1, s => { s.confirmEmail = true; });
  await store.start();
  assert.equal(await store.register('Hana', 'hana@example.com', 'secret1'), true);
  assert.match(store.state.message!.text, /Đã gửi thư xác nhận tới hana@example.com/);
  assert.equal(store.signedIn, false);
  assert.equal(await store.login('hana@example.com', 'secret1'), false);
  assert.match(store.state.message!.text, /chưa được xác nhận/);
  server.confirm('hana@example.com');
  assert.equal(await store.login('hana@example.com', 'secret1'), true);
  assert.equal(store.signedIn, true);
});

test('login errors and logout', async () => {
  const { stores: [store] } = browsers(1);
  await store.start();
  await signUp(store, 'Hana');
  await store.logout();
  assert.equal(store.signedIn, false);
  assert.equal(store.state.profile, null);
  assert.equal(await store.login('hana@example.com', 'wrong'), false);
  assert.equal(store.state.message!.text, 'Sai email hoặc mật khẩu.');
  assert.equal(await store.login('', 'x'), false);
  assert.equal(await store.login('hana@example.com', ''), false);
  assert.equal(await store.login('hana@example.com', 'secret1'), true);
});

test('friends: search, ask, the other side sees the request at once, accepts, and both lists agree', async () => {
  const { stores: [hana, minh] } = browsers();
  await hana.start(); await minh.start();
  await signUp(hana, 'Hana'); await signUp(minh, 'Minh');
  await hana.search('mi');
  assert.deepEqual(hana.state.results.map(p => p.username), ['Minh']);
  await hana.search('x');
  assert.deepEqual(hana.state.results, [], 'a one-letter search finds nobody');
  await hana.search('mi');
  await hana.addFriend(hana.state.results[0]);
  assert.match(hana.state.message!.text, /Đã gửi lời mời/);
  assert.equal(hana.outgoing.length, 1);
  assert.equal(hana.friends.length, 0);
  // The other browser is nudged and reloads by itself.
  await new Promise(r => setTimeout(r, 10));
  assert.equal(minh.incoming.length, 1);
  assert.equal(minh.incoming[0].person.username, 'Hana');
  await hana.addFriend(hana.state.results[0]);
  assert.match(hana.state.message!.text, /đã gửi lời mời rồi/i, 'asking twice is refused');
  await minh.accept(minh.incoming[0]);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(minh.friends.map(e => e.person.username), ['Hana']);
  assert.deepEqual(hana.friends.map(e => e.person.username), ['Minh']);
  assert.equal(hana.isFriend(minh.state.account!.id), true);
  assert.equal(hana.incoming.length + hana.outgoing.length + minh.incoming.length + minh.outgoing.length, 0);
});

test('asking somebody who already asked you makes you friends straight away', async () => {
  const { stores: [hana, minh] } = browsers();
  await hana.start(); await minh.start();
  await signUp(hana, 'Hana'); await signUp(minh, 'Minh');
  await hana.search('Minh'); await hana.addFriend(hana.state.results[0]);
  await minh.search('Hana'); await minh.addFriend(minh.state.results[0]);
  assert.match(minh.state.message!.text, /đã là bạn bè/);
  assert.equal(minh.friends.length, 1);
});

test('declining, cancelling and unfriending all remove the row and nudge the other side', async () => {
  const { stores: [hana, minh, lan] } = browsers(3);
  for (const s of [hana, minh, lan]) await s.start();
  await signUp(hana, 'Hana'); await signUp(minh, 'Minh'); await signUp(lan, 'Lan');
  await hana.search('Minh'); await hana.addFriend(hana.state.results[0]);
  await hana.search('Lan'); await hana.addFriend(hana.state.results[0]);
  await new Promise(r => setTimeout(r, 10));
  await minh.remove(minh.incoming[0]);                 // decline
  await hana.remove(hana.outgoing[0]);                 // cancel
  await new Promise(r => setTimeout(r, 10));
  assert.equal(hana.state.edges.length, 0);
  assert.equal(minh.state.edges.length, 0);
  assert.equal(lan.incoming.length, 0, 'the cancelled request is gone for Lan too');
  // Befriend and unfriend.
  await hana.search('Minh'); await hana.addFriend(hana.state.results[0]);
  await new Promise(r => setTimeout(r, 10));
  await minh.accept(minh.incoming[0]);
  await hana.remove(hana.friends[0]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(minh.friends.length, 0);
});

test('presence and invites: friends see who is online and in which room, invites reach the right person, strangers are ignored', async () => {
  const { stores: [hana, minh, lan] } = browsers(3);
  for (const s of [hana, minh, lan]) await s.start();
  await signUp(hana, 'Hana'); await signUp(minh, 'Minh'); await signUp(lan, 'Lan');
  await hana.search('Minh'); await hana.addFriend(hana.state.results[0]);
  await new Promise(r => setTimeout(r, 10));
  await minh.accept(minh.incoming[0]);
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(hana.onlineFriends().map(f => f.edge.person.username), ['Minh']);
  assert.equal(hana.onlineFriends()[0].info.room, null);
  minh.setRoom('ABCDE');
  assert.equal(hana.onlineFriends()[0].info.room, 'ABCDE', 'Hana sees Minh is in a room');
  // Hana is not in a room yet: inviting says so.
  hana.invite(hana.friends[0].person);
  assert.match(hana.state.message!.text, /tạo hoặc vào một phòng/);
  hana.setRoom('XYZ99');
  hana.invite(hana.friends[0].person);
  assert.match(hana.state.message!.text, /Đã mời Minh vào phòng XYZ99/);
  assert.deepEqual(minh.state.invites, [{ from: hana.state.account!.id, name: 'Hana', room: 'XYZ99' }]);
  assert.equal(lan.state.invites.length, 0);
  // An invite from a stranger is dropped (Lan is nobody's friend, but Minh has a friend list).
  lan.setRoom('STRNG');
  const server = (lan as unknown as { api: { server: FakeSocialServer } }).api.server;
  server.online.get(minh.state.account!.id)!.handlers.onInvite({ from: lan.state.account!.id, name: 'Lan', room: 'STRNG' });
  assert.equal(minh.state.invites.length, 1, 'the stranger\'s invite was ignored');
  minh.dismissInvite(hana.state.account!.id);
  assert.equal(minh.state.invites.length, 0);
  // Signing out removes you from presence.
  await minh.logout();
  assert.deepEqual(hana.onlineFriends(), []);
});

test('match results are reported once per match, only when signed in, and show up on the profile and the leaderboard', async () => {
  const { stores: [hana, minh, guest] } = browsers(3);
  for (const s of [hana, minh, guest]) await s.start();
  await guest.reportMatch(true, 3, 1);
  assert.equal(guest.state.profile, null, 'a guest has no record');
  await signUp(hana, 'Hana'); await signUp(minh, 'Minh');
  hana.newMatch();
  await hana.reportMatch(true, 5, 1);
  await hana.reportMatch(true, 5, 1);
  assert.deepEqual([hana.state.profile!.matches, hana.state.profile!.wins, hana.state.profile!.kills, hana.state.profile!.bestRank], [1, 1, 5, 1], 'the second report of the same match is ignored');
  hana.newMatch();
  await hana.reportMatch(false, 2, 7);
  assert.deepEqual([hana.state.profile!.matches, hana.state.profile!.wins, hana.state.profile!.kills, hana.state.profile!.bestRank], [2, 1, 7, 1]);
  minh.newMatch();
  await minh.reportMatch(false, 1, 12);
  await hana.loadLeaderboard();
  assert.deepEqual(hana.state.leaderboard.map(p => p.username), ['Hana', 'Minh']);
});

test('a server without the SQL applied is reported, and server errors are shown instead of thrown', async () => {
  const { server, stores: [store] } = browsers(1, s => { s.tables = false; });
  await store.start();
  assert.equal(store.state.readiness, 'no-tables');
  server.tables = true;
  server.failNext = 'Không kết nối được máy chủ. Kiểm tra mạng.';
  assert.equal(await store.register('Hana', 'hana@example.com', 'secret1'), false);
  assert.match(store.state.message!.text, /Không kết nối/);
  assert.equal(store.state.busy, false);
});

test('Supabase error messages become Vietnamese advice', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ message: 'Invalid login credentials' }, /Sai email hoặc mật khẩu/],
    [{ message: 'Email not confirmed' }, /chưa được xác nhận/],
    [{ message: 'User already registered' }, /đã được đăng ký/],
    [{ message: 'Password should be at least 6 characters.' }, /6 ký tự/],
    [{ message: 'email rate limit exceeded', status: 429 }, /quá nhiều lần/],
    [{ message: 'duplicate key value', code: '23505' }, /Đã có yêu cầu hoặc đã là bạn/],
    [{ message: 'relation "public.profiles" does not exist', code: '42P01' }, /setup\.sql/],
    [{ message: 'Failed to fetch' }, /Không kết nối được/],
    [{ message: 'something odd' }, /something odd/],
    [undefined, /Có lỗi/],
  ];
  for (const [error, expected] of cases) assert.match(friendlyError(error).message, expected);
});

test('a failed confirmation link is explained, and an ordinary address is left alone', async () => {
  const { linkErrorMessage } = await import('../src/social/store.ts');
  assert.match(linkErrorMessage('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=')!, /hết hạn/);
  assert.match(linkErrorMessage('#error=access_denied')!, /không hợp lệ/);
  assert.equal(linkErrorMessage(''), null);
  assert.equal(linkErrorMessage('#access_token=abc&type=signup'), null);
});
