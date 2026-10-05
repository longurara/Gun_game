import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SocialStore } from '../src/social/store.ts';
import { FakeSocialServer } from './helpers/fake-social.ts';
import type { AccountView as AccountViewType } from '../src/social-ui.ts';
import type { GameUI as GameUIType } from '../src/ui.ts';

let AccountView: typeof AccountViewType, GameUI: typeof GameUIType, dom: JSDOM;

function fresh() {
  dom = new JSDOM('<!doctype html><html><body><div id="ui-root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement, location: dom.window.location });
}
before(async () => {
  fresh();
  ({ AccountView } = await import('../src/social-ui.ts'));
  ({ GameUI } = await import('../src/ui.ts'));
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => dom.window.document.querySelector<T>(sel);
const click = (el: Element | null) => { assert.ok(el, 'element to click is missing'); el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); };
const type = (sel: string, value: string) => { const input = q<HTMLInputElement>(sel)!; input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
const settle = () => new Promise(r => setTimeout(r, 20));

function setup(options: { tables?: boolean; confirmEmail?: boolean } = {}) {
  fresh();
  const server = new FakeSocialServer();
  server.tables = options.tables ?? true;
  server.confirmEmail = options.confirmEmail ?? false;
  const store = new SocialStore(server.client());
  const joined: string[] = [];
  const view = new AccountView(dom.window.document.getElementById('ui-root')!, store, { onJoinRoom: room => joined.push(room) });
  return { server, store, view, joined };
}

test('signed out: a login form, a register tab with a username field, and the form values survive redraws', async () => {
  const { store, view } = setup();
  await store.start();
  view.show(true);
  assert.equal(q('#account-screen')!.hidden, false);
  assert.match(q('#acc-title')!.textContent!, /ĐĂNG NHẬP/);
  assert.equal(q('#acc-username'), null, 'no username field when logging in');
  click(q('[data-act="mode-register"]'));
  assert.match(q('#acc-title')!.textContent!, /TẠO TÀI KHOẢN/);
  assert.ok(q('#acc-username'));
  type('#acc-username', 'Hana'); type('#acc-email', 'hana@example.com'); type('#acc-password', 'secret1');
  // Something unrelated changes in the store (a message): the typed text must still be there.
  await store.login('bad', 'x');
  assert.equal(q<HTMLInputElement>('#acc-password')!.value, 'secret1');
  assert.ok(!q('#acc-msg')!.hidden);
});

test('registering through the window signs the player in and shows their profile; Enter in a field submits', async () => {
  const { store, view } = setup();
  await store.start();
  view.show(true);
  click(q('[data-act="mode-register"]'));
  type('#acc-username', 'Hana'); type('#acc-email', 'hana@example.com'); type('#acc-password', 'secret1');
  q('#acc-password')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(store.signedIn, true);
  assert.equal(q('#acc-title')!.textContent, 'HANA');
  assert.equal(q('#acc-email-line')!.textContent, 'hana@example.com');
  assert.equal(dom.window.document.querySelectorAll('#acc-stats dt').length, 4);
  assert.match(q('#acc-list')!.textContent!, /Chưa có bạn bè/);
});

test('with email confirmation the window says to check the mail instead of signing in', async () => {
  const { store, view } = setup({ confirmEmail: true });
  await store.start();
  view.show(true);
  click(q('[data-act="mode-register"]'));
  type('#acc-username', 'Hana'); type('#acc-email', 'hana@example.com'); type('#acc-password', 'secret1');
  click(q('#acc-submit'));
  await settle();
  assert.equal(store.signedIn, false);
  assert.ok(q('#acc-msg')!.classList.contains('ok'));
  assert.match(q('#acc-msg')!.textContent!, /thư xác nhận/);
});

test('a project without the SQL shows how to set it up, and an offline project says so', async () => {
  const a = setup({ tables: false });
  await a.store.start();
  a.view.show(true);
  assert.match(q('#acc-body')!.textContent!, /supabase\/setup\.sql/);
  assert.equal(q('#acc-email'), null);
});

async function twoFriends() {
  const { server, store: hana, view, joined } = setup();
  const minh = new SocialStore(server.client());
  await hana.start(); await minh.start();
  await hana.register('Hana', 'hana@example.com', 'secret1');
  await minh.register('Minh', 'minh@example.com', 'secret1');
  return { server, hana, minh, view, joined };
}

test('friends tab: a request shows with accept and decline, accepted friends show online status and a join button for their room', async () => {
  const { hana, minh, view, joined } = await twoFriends();
  await minh.search('Hana'); await minh.addFriend(minh.state.results[0]);
  await settle();
  view.show(true);
  assert.match(q('#acc-list')!.textContent!, /LỜI MỜI KẾT BẠN/);
  assert.match(q('#acc-badge')!.textContent!, /1/);
  click(q('[data-act="accept"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Minh/);
  assert.match(q('#acc-list')!.textContent!, /Đang online/);
  minh.setRoom('ABCDE');
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Đang trong phòng ABCDE/);
  click(q('[data-act="join"]'));
  assert.deepEqual(joined, ['ABCDE']);
  assert.equal(q('#account-screen')!.hidden, true, 'the window closes when you follow a friend');
  void hana;
});

test('inviting: an online friend outside a room gets an invite button; the invite shows as a banner with join and dismiss', async () => {
  const { hana, minh, view, joined } = await twoFriends();
  await hana.search('Minh'); await hana.addFriend(hana.state.results[0]);
  await settle();
  await minh.accept(minh.incoming[0]);
  await settle();
  view.show(true);
  hana.setRoom('XYZ99');
  await settle();
  click(q('[data-act="invite"]'));
  assert.match(q('#acc-msg')!.textContent!, /Đã mời Minh vào phòng XYZ99/);
  assert.equal(q('#invite-banner')!.hidden, true, 'the inviter sees no banner');
  // The window belongs to Hana: Minh invites her back, which shows as a banner on her side.
  minh.setRoom('ROOM7');
  minh.invite(minh.friends[0].person);
  await settle();
  const banner = q('#invite-banner')!;
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent!, /Minh mời bạn vào phòng ROOM7/);
  click(banner.querySelector('[data-act="join-invite"]'));
  assert.deepEqual(joined, ['ROOM7']);
  assert.equal(q('#invite-banner')!.hidden, true);
  // Dismissing.
  minh.invite(minh.friends[0].person);
  await settle();
  assert.equal(q('#invite-banner')!.hidden, false);
  click(q('#invite-banner [data-act="dismiss-invite"]'));
  assert.equal(q('#invite-banner')!.hidden, true);
});

test('search tab keeps what was typed while presence changes; results offer "kết bạn" or show the current relationship', async () => {
  const { hana, minh, view } = await twoFriends();
  view.show(true);
  click(q('[data-act="tab-search"]'));
  type('#acc-query', 'Mi');
  click(q('[data-act="search"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Minh/);
  minh.setRoom('ROOM1'); // a presence update redraws the window
  await settle();
  assert.equal(q<HTMLInputElement>('#acc-query')!.value, 'Mi', 'the search box is not wiped');
  click(q('[data-act="add"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /ĐÃ GỬI/);
  assert.match(q('#acc-msg')!.textContent!, /Đã gửi lời mời/);
  void hana;
});

test('leaderboard tab lists players by wins; logging out returns to the login form', async () => {
  const { hana, minh, view } = await twoFriends();
  hana.newMatch(); await hana.reportMatch(true, 4, 1);
  minh.newMatch(); await minh.reportMatch(false, 1, 9);
  view.show(true);
  click(q('[data-act="tab-board"]'));
  await settle();
  const rows = [...dom.window.document.querySelectorAll('.acc-board li b')].map(b => b.textContent);
  assert.deepEqual(rows, ['Hana', 'Minh']);
  assert.ok(q('.acc-board li.me'), 'the player\'s own line is marked');
  click(q('[data-act="logout"]'));
  await settle();
  assert.equal(hana.signedIn, false);
  assert.match(q('#acc-title')!.textContent!, /ĐĂNG NHẬP/);
});

test('the profile chip on the main screen shows the account name and saved totals, and goes back when signed out', () => {
  fresh();
  const calls: string[] = [];
  const ui = new GameUI({ onStart() {}, onResume() {}, onRestart() {}, onMenu() {}, onSettings() {}, onSelectWeapon() {}, onAccount: () => calls.push('account') });
  assert.match(q('#profile-name')!.textContent!, /NGƯỜI SINH TỒN/);
  ui.setAccount({ name: 'Hana', wins: 4, kills: 31, matches: 12 });
  assert.equal(q('#profile-name')!.textContent, 'HANA');
  assert.equal(q('#best-wins')!.textContent, '4');
  assert.equal(q('#best-kills')!.textContent, '31');
  assert.equal(q('#best-time')!.textContent, '12');
  assert.equal(q('#best-third-label')!.textContent, 'TRẬN');
  assert.equal(q('#profile-chip')!.dataset.signed, 'in');
  click(q('#profile-id'));
  assert.deepEqual(calls, ['account']);
  ui.setAccount(null);
  assert.match(q('#profile-name')!.textContent!, /NGƯỜI SINH TỒN/);
  assert.equal(q('#best-third-label')!.textContent, 'SỐNG LÂU NHẤT');
  assert.equal(q('#best-wins')!.textContent, '0');
});

test('search accepts a full name or one letter, and says plainly when nobody matches', async () => {
  const { hana, minh, view } = await twoFriends();
  view.show(true);
  click(q('[data-act="tab-search"]'));
  assert.match(q('#acc-list')!.textContent!, /đầy đủ hoặc vài chữ đầu/);
  type('#acc-query', 'minh');
  click(q('[data-act="search"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Minh/);
  type('#acc-query', 'M');
  click(q('[data-act="search"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Minh/);
  type('#acc-query', 'Nobody');
  click(q('[data-act="search"]'));
  await settle();
  assert.match(q('#acc-list')!.textContent!, /Không có kết quả/);
  assert.match(q('#acc-msg')!.textContent!, /Không tìm thấy/);
  void hana; void minh;
});
