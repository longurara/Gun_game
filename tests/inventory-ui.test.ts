import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { InventoryView } from '../src/inventory-ui.ts';
import { emptyAmmo, emptyReserve, WEAPONS } from '../src/game/weapons.ts';
import { emptySupplies } from '../src/game/supplies.ts';
import type { Actor, Loot, LootKind } from '../src/types.ts';

function setup() {
  const dom = new JSDOM('<!doctype html><html><body><button id="opener">Kho đồ</button><div id="ui-root"></div></body></html>', { pretendToBeVisual: true });
  Object.assign(globalThis, { document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  const calls = { close: 0, weapons: [] as string[], pickups: [] as string[], drops: [] as Array<{ kind: LootKind; amount: number }>, heals: 0, open: [] as boolean[] };
  let view: InventoryView;
  view = new InventoryView(dom.window.document.getElementById('ui-root')!, {
    onClose: () => { calls.close++; view.show(false); },
    onSelectWeapon: weapon => calls.weapons.push(weapon),
    onPickup: id => calls.pickups.push(id),
    onDrop: (kind, amount) => calls.drops.push({ kind, amount }),
    onHeal: () => calls.heals++,
    onOpenChange: open => calls.open.push(open),
  });
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => dom.window.document.querySelector<T>(selector)!;
  const click = (selector: string) => q(selector).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const key = (element: HTMLElement, value: string, shiftKey = false) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  return { dom, view, calls, q, click, key };
}

function player(): Actor {
  return {
    id: 'player', name: 'Hikari', isPlayer: true, position: { x: 0, y: 0, z: 0 }, yaw: 0,
    health: 67, alive: true, weapon: 'rifle', ownedWeapons: ['rifle', 'shotgun', 'pistol'],
    ammo: { ...emptyAmmo(), rifle: 17, shotgun: 3, pistol: 8 }, reserve: { ...emptyReserve(), '556': 83, '12g': 7, '9mm': 24 },
    reloading: 0, healing: 0, medkits: 2, hurtTimer: 0, helmet: 2, helmetHp: 57, vest: 1, vestHp: 32,
    supplies: emptySupplies(), boost: 0,
  };
}

test('inventory is a named dialog, updates only while open, and returns focus to its opener', () => {
  const { view, q, dom, calls } = setup();
  assert.equal(view.open, false);
  view.update(player(), []);
  assert.equal(q('#inventory-player-name').textContent, 'NGƯỜI SINH TỒN');
  q('#opener').focus();
  view.show(true);
  assert.equal(view.open, true);
  assert.equal(q('#inventory-screen').getAttribute('role'), 'dialog');
  assert.equal(q('#inventory-screen').getAttribute('aria-labelledby'), 'inventory-title');
  assert.equal(q('#inventory-title').textContent, 'KHO ĐỒ');
  assert.equal(dom.window.document.activeElement, q('#inventory-close'));
  assert.equal(view.canvas, q('#inventory-character'));
  view.update(player(), []);
  assert.equal(q('#inventory-player-name').textContent, 'Hikari');
  view.show(false);
  assert.equal(dom.window.document.activeElement, q('#opener'));
  view.show(false);
  assert.deepEqual(calls.open, [true, false]);
});

test('carried counts, shared reserves, equipped slot and armour durability come from the actor', () => {
  const { view, q } = setup();
  const actor = player();
  view.show(true); view.update(actor, []);
  assert.equal(q('#inventory-health').textContent, '67 / 100');
  assert.equal(q('#inventory-health-fill').style.transform, 'scaleX(0.67)');
  assert.equal(q('#inventory-carried-count').textContent, '4 LOẠI');
  assert.equal(q('[data-slot="1"] .inventory-weapon-name').textContent, WEAPONS.rifle.label);
  assert.equal(q('[data-slot="1"] .inventory-weapon-ammo b').textContent, '17 / ' + WEAPONS.rifle.magazine);
  assert.equal(q('[data-slot="1"] .inventory-weapon-ammo small').textContent, '83 dự trữ');
  assert.equal(q('[data-slot="1"] .inventory-weapon-select').getAttribute('aria-pressed'), 'true');
  assert.equal(q('[data-armor="helmet"] small').textContent, 'CẤP 2 · 57 / 150');
  assert.equal(q('[data-armor="vest"] small').textContent, 'CẤP 1 · 32 / 80');
  assert.equal(q('[data-kind="medkit"]').closest('.inventory-item-row')!.querySelector('.inventory-item-count')!.textContent, '×2');
  actor.weapon = 'pistol'; actor.reserve['556'] = 0; actor.helmet = 0; actor.helmetHp = 0;
  view.update(actor, []);
  assert.equal(q('#inventory-carried-count').textContent, '3 LOẠI');
  assert.equal(q('[data-slot="3"] .inventory-weapon-select').getAttribute('aria-pressed'), 'true');
  assert.equal(q('[data-armor="helmet"] small').textContent, 'CHƯA TRANG BỊ');
  assert.equal(q<HTMLButtonElement>('[data-armor="helmet"] button').hidden, true);
});

test('select, pickup, ammo drop and medkit actions delegate accurate IDs and quantities', () => {
  const { view, calls, click, q } = setup();
  const actor = player();
  const loot: Loot[] = [
    { id: 'ammo-partial', kind: '556Ammo', amount: 11, position: { x: 2, y: 0, z: 0 }, active: true },
    { id: 'meds', kind: 'medkit', amount: 3, position: { x: 1, y: 0, z: 0 }, active: true },
    { id: 'inactive', kind: 'medkit', position: { x: 0, y: 0, z: 0 }, active: false },
    { id: 'dropped-gun', kind: 'shotgun', loadedAmmo: 2, position: { x: 3, y: 0, z: 0 }, active: true },
    { id: 'worn-vest', kind: 'vest2', durability: 19, position: { x: 4, y: 0, z: 0 }, active: true },
  ];
  view.show(true); view.update(actor, loot);
  assert.equal(q('#inventory-nearby-count').textContent, '4 VẬT PHẨM');
  assert.equal(q('#inventory-nearby-list button').dataset.lootId, 'meds', 'closest loot appears first');
  assert.equal(q('[data-loot-id="ammo-partial"]').closest('.inventory-item-row')!.querySelector('.inventory-item-count')!.textContent, '+11');
  assert.equal(q('[data-loot-id="meds"]').closest('.inventory-item-row')!.querySelector('.inventory-item-count')!.textContent, '+3');
  assert.match(q('[data-loot-id="dropped-gun"]').closest('.inventory-item-row')!.textContent!, /2 đạn trong súng/);
  assert.match(q('[data-loot-id="worn-vest"]').closest('.inventory-item-row')!.textContent!, /19 \/ 150 độ bền/);
  click('[data-slot="3"] .inventory-weapon-select');
  click('[data-loot-id="ammo-partial"]');
  click('#inventory-carried-list button[data-kind="556Ammo"]');
  click('#inventory-carried-list button[data-kind="12gAmmo"]');
  click('[data-inventory-action="heal"]');
  click('#inventory-carried-list button[data-kind="medkit"]');
  click('[data-armor="helmet"] button');
  assert.deepEqual(calls.weapons, ['pistol']);
  assert.deepEqual(calls.pickups, ['ammo-partial']);
  assert.deepEqual(calls.drops, [{ kind: '556Ammo', amount: 30 }, { kind: '12gAmmo', amount: 7 }, { kind: 'medkit', amount: 1 }, { kind: 'helmet2', amount: 1 }]);
  assert.equal(calls.heals, 1);
});

test('the final owned weapon and unsafe actor actions cannot be dropped or used', () => {
  const { view, q, click, calls } = setup();
  const actor = player();
  actor.ownedWeapons = ['rifle'];
  view.show(true); view.update(actor, [{ id: 'near', kind: 'medkit', position: { x: 1, y: 0, z: 0 }, active: true }]);
  assert.equal(q<HTMLButtonElement>('[data-slot="1"] .inventory-weapon-drop').disabled, true);
  assert.equal(q<HTMLButtonElement>('[data-slot="2"] .inventory-weapon-select').disabled, true);
  click('[data-slot="1"] .inventory-weapon-drop');
  assert.deepEqual(calls.drops, []);
  actor.health = 100; view.update(actor, []);
  assert.equal(q<HTMLButtonElement>('[data-inventory-action="heal"]').disabled, true);
  actor.health = 40; actor.healing = 2; view.update(actor, []);
  assert.equal(q<HTMLButtonElement>('[data-inventory-action="heal"]').disabled, true);
  assert.equal(q('[data-inventory-action="heal"]').textContent, 'ĐANG DÙNG');
  actor.healing = 0; actor.air = { mode: 'chute', vx: 0, vy: 0, vz: 0, time: 1 };
  view.update(actor, [{ id: 'near', kind: 'medkit', position: { x: 1, y: 0, z: 0 }, active: true }]);
  assert.equal(q<HTMLButtonElement>('[data-loot-id="near"]').disabled, true);
  assert.equal(q<HTMLButtonElement>('#inventory-carried-list button[data-kind="medkit"]').disabled, true);
  assert.equal(q<HTMLButtonElement>('[data-armor="vest"] button').disabled, true);
  click('[data-loot-id="near"]'); click('[data-inventory-action="heal"]'); click('[data-armor="vest"] button');
  assert.deepEqual(calls.pickups, []); assert.deepEqual(calls.drops, []); assert.equal(calls.heals, 0);
});

test('open updates preserve item buttons and their focus, and removal restores usable focus', () => {
  const { view, q, dom } = setup();
  const actor = player();
  const loot: Loot[] = [{ id: 'near', kind: 'medkit', position: { x: 1, y: 0, z: 0 }, active: true }];
  view.show(true); view.update(actor, loot);
  const button = q('[data-loot-id="near"]');
  button.focus(); actor.reserve['556']++;
  view.update(actor, loot);
  assert.equal(q('[data-loot-id="near"]'), button);
  assert.equal(dom.window.document.activeElement, button);
  const drop = q('#inventory-carried-list button[data-kind="556Ammo"]');
  drop.focus(); actor.reserve['556'] = 41; view.update(actor, loot);
  assert.equal(q('#inventory-carried-list button[data-kind="556Ammo"]'), drop);
  assert.equal(dom.window.document.activeElement, drop);
  actor.reserve['556'] = 0; view.update(actor, loot);
  assert.equal(dom.window.document.activeElement, q('#inventory-close'));
});

test('Tab is trapped in the dialog and Escape closes without reaching game handlers', () => {
  const { view, q, key, dom, calls } = setup();
  view.show(true); view.update(player(), []);
  let propagated = 0;
  dom.window.document.addEventListener('keydown', () => propagated++);
  const last = [...q('#inventory-screen').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(button => !button.closest('[hidden]')).at(-1)!;
  key(q('#inventory-close'), 'Tab', true);
  assert.equal(dom.window.document.activeElement, last);
  key(last, 'Tab');
  assert.equal(dom.window.document.activeElement, q('#inventory-close'));
  key(q('#inventory-close'), 'Escape');
  assert.equal(calls.close, 1); assert.equal(view.open, false); assert.equal(propagated, 0);
});

test('player names are rendered as text and online help describes a live match', () => {
  const { view, q, dom } = setup();
  const actor = player(); actor.name = '<img src=x onerror="alert(1)">';
  view.show(true); view.update(actor, [], { online: true });
  assert.equal(q('#inventory-player-name').textContent, actor.name);
  assert.equal(dom.window.document.querySelector('#inventory-player-name img'), null);
  assert.match(q('#inventory-status').textContent!, /Trận online vẫn tiếp tục/);
  view.update(actor, []);
  assert.match(q('#inventory-status').textContent!, /Trận đấu vẫn tiếp diễn/);
});
