/** The main screen keeps deployment controls small; large pickers have their own windows. */
export class MainMenuView {
  private readonly screen: HTMLElement;
  private readonly background: HTMLElement[];
  private readonly layers: HTMLElement[];
  private opener: HTMLElement | null = null;
  private active: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.screen = root.querySelector<HTMLElement>('#menu-screen')!;
    this.screen.classList.add('lobby-command');
    const nav = this.screen.querySelector('.lobby-nav')!;
    const mapTab = this.button('tab-maps', 'BẢN ĐỒ');
    const characterTab = this.button('tab-character', 'NHÂN VẬT');
    mapTab.className = characterTab.className = 'tab';
    nav.insertBefore(mapTab, nav.querySelector('#tab-settings'));
    nav.insertBefore(characterTab, nav.querySelector('#tab-settings'));
    const dock = this.screen.querySelector<HTMLElement>('.lobby-panel')!;
    dock.classList.add('deployment-dock');
    const play = dock.querySelector('#play-panel')!;
    const choices = this.screen.querySelector<HTMLElement>('#map-choice')!;
    const picker = this.button('map-picker', 'ĐỔI BẢN ĐỒ');
    picker.setAttribute('aria-haspopup', 'dialog');
    picker.setAttribute('aria-controls', 'menu-map-dialog');
    play.querySelector('.panel-title')!.replaceChildren(this.label('CHỌN TRẬN', 'span'), picker);
    const content = document.createElement('div'); content.className = 'deployment-content';
    content.append(play.querySelector('.panel-title')!, play.querySelector('.mode-card')!, play.querySelector('.panel-row')!);
    const actions = document.createElement('div'); actions.className = 'deployment-actions';
    actions.append(play.querySelector('#start-button')!, play.querySelector('#multi-button')!);
    play.replaceChildren(content, actions);

    const maps = document.createElement('section');
    maps.id = 'menu-map-dialog'; maps.className = 'menu-modal'; maps.hidden = true;
    this.dialog(maps, 'CHỌN CHIẾN TRƯỜNG', 'menu-maps-title', 'menu-maps-close');
    const mapBody = document.createElement('div'); mapBody.className = 'menu-modal-body map-picker-body';
    choices.querySelectorAll('button').forEach(button => {
      const preview = document.createElement('span'); preview.className = 'map-tile-art'; preview.setAttribute('aria-hidden', 'true');
      button.prepend(preview);
    });
    mapBody.append(choices);
    const mapFoot = document.createElement('footer'); mapFoot.className = 'menu-modal-foot';
    mapFoot.append(this.screen.querySelector('#preview-blurb')!);
    maps.firstElementChild!.append(mapBody, mapFoot);
    this.screen.append(maps);

    const settings = this.screen.querySelector<HTMLElement>('#settings-panel')!;
    const groups = [...settings.querySelectorAll<HTMLElement>('.set-group')];
    const foot = settings.querySelector<HTMLElement>('.set-foot')!;
    const back = settings.querySelector<HTMLElement>('#back-play')!;
    const titles = ['NHÂN VẬT', 'ÂM THANH', 'ĐIỀU KHIỂN', 'ĐỒ HỌA', 'TRỢ GIÚP'];
    const keys = ['character', 'audio', 'controls', 'graphics', 'help'];
    settings.replaceChildren(); settings.classList.add('menu-modal');
    this.dialog(settings, 'THIẾT LẬP', 'menu-settings-title', 'menu-settings-close');
    const body = document.createElement('div'); body.className = 'menu-modal-body settings-layout';
    const tabs = document.createElement('nav'); tabs.id = 'settings-categories'; tabs.className = 'settings-categories';
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Nhóm thiết lập'); tabs.setAttribute('aria-orientation', 'vertical');
    const scroll = document.createElement('div'); scroll.className = 'settings-content';
    groups.forEach((group, index) => {
      const key = keys[index]; group.id = `settings-group-${key}`; group.dataset.settingsGroup = key;
      group.setAttribute('role', 'tabpanel'); group.setAttribute('aria-labelledby', `settings-category-${key}`);
      const tab = this.button(`settings-category-${key}`, titles[index]);
      tab.dataset.settingsCategory = key; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', group.id);
      tab.addEventListener('click', () => this.selectCategory(key)); tabs.append(tab); scroll.append(group);
    });
    tabs.addEventListener('keydown', event => {
      const options = [...tabs.querySelectorAll<HTMLButtonElement>('button')];
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + options.length) % options.length;
      this.selectCategory(keys[next]); options[next].focus();
    });
    body.append(tabs, scroll);
    const settingsFoot = document.createElement('footer'); settingsFoot.className = 'menu-modal-foot settings-actions';
    settingsFoot.append(foot, back);
    settings.firstElementChild!.append(body, settingsFoot);
    this.screen.append(settings);
    this.selectCategory('audio');

    const footer = this.screen.querySelector('.lobby-foot')!;
    const help = document.createElement('details'); help.className = 'menu-controls';
    const summary = document.createElement('summary'); summary.textContent = 'ĐIỀU KHIỂN'; help.append(summary);
    const helpBody = document.createElement('div'); helpBody.className = 'menu-controls-body';
    footer.querySelectorAll('.guide-keys, .touch-guide, .touch-orientation-note').forEach(node => helpBody.append(node));
    help.append(helpBody); footer.append(help);
    const caption = this.label('LASTLIGHT · VÙNG SỐNG CUỐI CÙNG', 'span'); caption.className = 'menu-foot-label'; footer.prepend(caption);

    this.background = [...this.screen.querySelectorAll<HTMLElement>('.lobby-top, .lobby-stage, .lobby-foot')];
    this.layers = [maps, settings];
    picker.addEventListener('click', () => this.showMaps());
    mapTab.addEventListener('click', () => this.showMaps());
    characterTab.addEventListener('click', () => { this.showSettings(true); this.selectCategory('character'); });
    for (const layer of this.layers) {
      layer.addEventListener('click', event => { if (event.target === layer) this.close(); });
      layer.querySelector('.menu-modal-close')!.addEventListener('click', () => this.close());
    }
    this.screen.addEventListener('keydown', event => {
      if (!this.active) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...this.active.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
        .filter(element => !element.closest('[hidden]') && element.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }

  private label(text: string, tag: string): HTMLElement {
    const element = document.createElement(tag); element.textContent = text; return element;
  }
  private button(id: string, text: string): HTMLButtonElement {
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.textContent = text; return button;
  }
  private dialog(layer: HTMLElement, title: string, titleId: string, closeId: string): void {
    layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-labelledby', titleId);
    const card = document.createElement('div'); card.className = 'menu-modal-card';
    const head = document.createElement('header'); head.className = 'menu-modal-head';
    const heading = this.label(title, 'h2'); heading.id = titleId;
    const close = this.button(closeId, '✕'); close.className = 'menu-modal-close'; close.setAttribute('aria-label', 'Đóng');
    head.append(heading, close); card.append(head); layer.append(card);
  }
  private show(layer: HTMLElement): void {
    if (this.screen.hidden) return;
    if (!this.active) this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.layers.forEach(item => { item.hidden = item !== layer; }); this.active = layer;
    this.background.forEach(element => { element.inert = true; });
    this.screen.querySelectorAll<HTMLDetailsElement>('.menu-controls').forEach(element => { element.open = false; });
    layer.querySelector<HTMLElement>('.menu-modal-close')!.focus({ preventScroll: true });
  }
  public showMaps(): void { this.show(this.layers[0]); }
  public showSettings(show: boolean): void { if (show) this.show(this.layers[1]); else this.close(); }
  public close(restoreFocus = true): void {
    this.layers.forEach(layer => { layer.hidden = true; }); this.active = null;
    this.background.forEach(element => { element.inert = false; });
    if (restoreFocus && !this.screen.hidden && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }
  public selectCategory(key: string): void {
    this.screen.querySelectorAll<HTMLElement>('[data-settings-group]').forEach(group => { group.hidden = group.dataset.settingsGroup !== key; });
    this.screen.querySelectorAll<HTMLButtonElement>('[data-settings-category]').forEach(tab => {
      const selected = tab.dataset.settingsCategory === key; tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    const content = this.screen.querySelector('.settings-content'); if (content) content.scrollTop = 0;
  }
}
