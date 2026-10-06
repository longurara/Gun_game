import type { GameAudio } from './audio';
import w from './assets/ui/input-prompts/keyboard_w.svg';
import a from './assets/ui/input-prompts/keyboard_a.svg';
import s from './assets/ui/input-prompts/keyboard_s.svg';
import d from './assets/ui/input-prompts/keyboard_d.svg';
import space from './assets/ui/input-prompts/keyboard_space.svg';
import escape from './assets/ui/input-prompts/keyboard_escape.svg';
import e from './assets/ui/input-prompts/keyboard_e.svg';
import f from './assets/ui/input-prompts/keyboard_f.svg';
import one from './assets/ui/input-prompts/keyboard_1.svg';
import two from './assets/ui/input-prompts/keyboard_2.svg';
import three from './assets/ui/input-prompts/keyboard_3.svg';
import tab from './assets/ui/input-prompts/keyboard_tab.svg';
import m from './assets/ui/input-prompts/keyboard_m.svg';
import mouseLeft from './assets/ui/input-prompts/mouse_left.svg';
import mouseRight from './assets/ui/input-prompts/mouse_right.svg';
import move from './assets/ui/input-prompts/touch_swipe_move.svg';
import swipe from './assets/ui/input-prompts/touch_swipe_horizontal.svg';
import tap from './assets/ui/input-prompts/touch_tap.svg';
import hover from './assets/audio/interface/hover.ogg';
import click from './assets/audio/interface/click.ogg';
import confirm from './assets/audio/interface/confirm.ogg';
import back from './assets/audio/interface/back.ogg';

const sounds = { hover, click, confirm, back };
const glyphs = (urls: string[], label: string) => `<kbd class="input-prompt" aria-label="${label}">${urls.map(url => `<img src="${url}" alt="" aria-hidden="true" width="28" height="28">`).join('')}</kbd>`;

/** Keep asset imports out of the DOM-only GameUI so its node tests don't need a bundler. */
export function installMenuAssets(root: HTMLElement, audio: GameAudio): void {
  const guide = root.querySelector('.desktop-controls');
  if (guide) guide.innerHTML = [
    [[w, a, s, d], 'W A S D', 'Di chuyển / lái dù'], [[space], 'Space', 'Nhảy dù · mở dù'],
    [[mouseLeft, mouseRight], 'Chuột trái / phải', 'Bắn / ngắm'], [[e], 'E', 'Nhặt đồ'],
    [[f], 'F', 'Lên / xuống xe'], [[one, two, three], '1 – 3', 'Chọn súng'],
    [[tab], 'Tab hoặc I', 'Kho đồ · Tab / I'], [[m], 'M', 'Bản đồ lớn'], [[escape], 'Esc', 'Tạm dừng'],
  ].map(([urls, label, text]) => `<span>${glyphs(urls as string[], label as string)}${text}</span>`).join('');
  const touchGuide = root.querySelector('.touch-guide');
  if (touchGuide) touchGuide.innerHTML = [
    [move, 'NGÓN TRÁI', 'Kéo cần để di chuyển'], [swipe, 'NGÓN PHẢI', 'Vuốt để xoay camera'],
    [tap, 'NÚT NGẮM', 'Bật / tắt ống ngắm'], [tap, 'NÚT NHẢY', 'Nhảy khỏi máy bay · mở dù'],
  ].map(([url, title, text]) => `<span><img src="${url}" alt="" aria-hidden="true" width="32" height="32"><span><b>${title}</b>${text}</span></span>`).join('');

  const creditsButton = document.createElement('button');
  creditsButton.id = 'asset-credits-button';
  creditsButton.className = 'asset-credits-button';
  creditsButton.type = 'button';
  creditsButton.textContent = 'NGUỒN ASSET';
  creditsButton.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog');
  dialog.id = 'asset-credits';
  dialog.className = 'dialog credits-dialog';
  dialog.setAttribute('aria-labelledby', 'asset-credits-title');
  dialog.innerHTML = `<div class="eyebrow"><span class="orange-dash"></span>LASTLIGHT · GHI CÔNG</div>
    <h2 id="asset-credits-title">NGUỒN ASSET</h2>
    <p>Cảm ơn các tác giả đã chia sẻ tài nguyên cho cộng đồng.</p>
    <ul class="asset-credit-list">
      <li><a href="https://colorosse.com/assets/2d/ui/bunker-panel-ui-kit" target="_blank" rel="noopener noreferrer">Bunker Panel UI Kit — single-framed panels and buttons</a>
        <span>Oğuzhan Girgin · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></span><small>Đã đổi màu tối/vàng và đơn giản hóa đường viền để phù hợp các kích thước màn hình.</small></li>
      <li><a href="https://kenney.nl/assets/input-prompts" target="_blank" rel="noopener noreferrer">Input Prompts</a><span>Kenney · CC0 1.0</span></li>
      <li><a href="https://kenney.nl/assets/interface-sounds" target="_blank" rel="noopener noreferrer">Interface Sounds</a><span>Kenney · CC0 1.0</span></li>
      <li><a href="https://kenney.nl/assets/ui-pack" target="_blank" rel="noopener noreferrer">UI Pack</a><span>Kenney · CC0 1.0 · biểu tượng thành tích và lựa chọn</span></li>
      <li><a href="https://quaternius.com/" target="_blank" rel="noopener noreferrer">Ultimate Guns Pack &amp; Ultimate Modular Men Pack</a><span>Quaternius · CC0 1.0 · súng và nhân vật SWAT</span></li>
    </ul><button id="asset-credits-close" class="button button-secondary" type="button">ĐÓNG</button>`;
  root.querySelector('.lobby-foot')?.appendChild(creditsButton);
  root.appendChild(dialog);
  creditsButton.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('#asset-credits-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => creditsButton.focus({ preventScroll: true }));

  const control = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('button, [role="button"], select, input[type="checkbox"]') : null;
    if (!element || element.matches(':disabled') || !element.closest('.lobby, .dialog')) return null;
    return element;
  };
  for (const type of ['pointerdown', 'keydown']) root.addEventListener(type, () => {
    void audio.unlock().then(() => audio.prepareInterfaceSounds(Object.values(sounds)));
  }, { once: true, capture: true });
  root.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse') return;
    const element = control(event.target);
    if (element && !(event.relatedTarget instanceof Node && element.contains(event.relatedTarget))) void audio.interfaceSound(sounds.hover, true);
  });
  // Capture before a click changes/hides its screen, including keyboard activation of native buttons.
  root.addEventListener('click', event => {
    const element = control(event.target);
    if (!element) return;
    const isBack = /close|back|leave|menu/.test(element.id);
    const isConfirm = /start|resume|create|join/.test(element.id);
    void audio.interfaceSound(isBack ? sounds.back : isConfirm ? sounds.confirm : sounds.click);
  }, { capture: true });
}
