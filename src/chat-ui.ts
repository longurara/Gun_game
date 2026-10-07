import { CHAT_LIMIT } from './net/chat';
import type { ChatMessage } from './net/chat';

export class ChatView {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly log: HTMLElement;
  private enabled = false;
  private online = true;
  private unread = 0;
  private lastId = 0;
  open = false;
  constructor(parent: HTMLElement, private readonly callbacks: { send(text: string): boolean; toggle(open: boolean): void; exit(): void }) {
    this.root = document.createElement('div'); this.root.className = 'match-comms'; this.root.hidden = true;
    this.root.innerHTML = `<button id="chat-toggle" type="button" aria-expanded="false" aria-controls="chat-panel">CHAT <kbd>Enter</kbd><b id="chat-unread" hidden></b></button>
      <section id="chat-panel" aria-label="Trò chuyện trong trận" hidden><header><strong>TRÒ CHUYỆN TRONG TRẬN</strong><button id="chat-close" type="button" aria-label="Đóng trò chuyện">×</button></header>
      <div id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <form id="chat-form"><input id="chat-input" autocomplete="off" aria-label="Tin nhắn" placeholder="Nhắn với mọi người…" maxlength="${CHAT_LIMIT * 2}"><button id="chat-send" type="submit">GỬI</button></form><small id="chat-hint">Enter để gửi · Esc để đóng · tối đa ${CHAT_LIMIT} ký tự</small></section>
      <section id="reconnect-banner" role="status" hidden><strong>ĐANG KẾT NỐI LẠI</strong><span>Nhân vật được bảo vệ trong thời gian chờ.</span><b id="reconnect-count"></b><button id="reconnect-exit" type="button">RỜI TRẬN</button></section>`;
    parent.appendChild(this.root);
    this.button = this.el('chat-toggle') as HTMLButtonElement; this.panel = this.el('chat-panel');
    this.input = this.el('chat-input') as HTMLInputElement; this.log = this.el('chat-log');
    this.button.addEventListener('click', () => this.toggle(!this.open));
    this.el('chat-close').addEventListener('click', () => this.toggle(false));
    this.el('reconnect-exit').addEventListener('click', () => callbacks.exit());
    this.el('chat-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!this.online || !this.input.value.trim()) return;
      if (callbacks.send(this.input.value)) { this.input.value = ''; this.el('chat-hint').textContent = `Enter để gửi · Esc để đóng · tối đa ${CHAT_LIMIT} ký tự`; }
      else this.el('chat-hint').textContent = `Tin nhắn tối đa ${CHAT_LIMIT} ký tự. Hãy chờ một chút nếu gửi quá nhanh.`;
      this.input.focus();
    });
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggle(false); }
      event.stopPropagation();
    });
  }
  private el(id: string): HTMLElement { return this.root.querySelector(`#${id}`)!; }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled; this.root.hidden = !enabled;
    if (!enabled) { this.toggle(false); this.log.replaceChildren(); this.lastId = 0; this.unread = 0; this.setReconnect(null); }
  }
  toggle(open: boolean): void {
    if (open && !this.enabled || open === this.open) return;
    this.open = open; this.panel.hidden = !open; this.button.setAttribute('aria-expanded', String(open));
    if (open) { this.unread = 0; this.badge(); this.log.scrollTop = this.log.scrollHeight; this.input.focus(); }
    else this.input.blur();
    this.callbacks.toggle(open);
  }
  render(rows: readonly ChatMessage[]): void {
    const wasAtBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 30;
    const lines = rows.map(row => {
      const line = document.createElement('p'), name = document.createElement('b'), text = document.createElement('span');
      name.textContent = row.name; text.textContent = row.text; line.append(name, text);
      if (!this.open && row.id > this.lastId) this.unread++;
      return line;
    });
    this.lastId = Math.max(this.lastId, ...rows.map(row => row.id));
    this.log.replaceChildren(...lines);
    if (wasAtBottom || !this.open) this.log.scrollTop = this.log.scrollHeight;
    this.badge();
  }
  private badge(): void {
    const badge = this.el('chat-unread'); badge.hidden = !this.unread; badge.textContent = this.unread > 99 ? '99+' : String(this.unread);
  }
  setReconnect(seconds: number | null): void {
    this.online = seconds === null;
    this.el('reconnect-banner').hidden = this.online;
    this.el('reconnect-count').textContent = `${seconds ?? 0} GIÂY CÒN LẠI`;
    (this.el('chat-send') as HTMLButtonElement).disabled = !this.online;
    this.input.disabled = !this.online;
  }
}
