import type { MatchSetup } from './session';
import type { NetMessage, Transport } from './transport';

export const CHAT_LIMIT = 240;
export const CHAT_HISTORY = 50;
export interface ChatMessage { id: number; name: string; text: string; from: string }
/** Plain text only; one chat message cannot grow into a large network packet. */
export function chatText(value: unknown): string {
  if (typeof value !== 'string' || value.length > CHAT_LIMIT * 4) return '';
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return [...text].length <= CHAT_LIMIT ? text : '';
}

/** A star of DataChannels: host authenticates names and forwards the room chat to guests. */
export class ChatSession {
  readonly history: ChatMessage[] = [];
  private listeners: Array<(rows: readonly ChatMessage[]) => void> = [];
  private members: Map<string, string>;
  private budgets = new Map<string, { tokens: number; at: number }>();
  private historyAt = new Map<string, number>();
  private seq = 0;
  constructor(private readonly transport: Transport, setup: MatchSetup, private readonly role: 'host' | 'client',
    private readonly hostId: string, private readonly clock: () => number = () => performance.now()) {
    this.members = new Map(setup.players.map(player => [player.clientId, player.name]));
    transport.onMessage((message, from) => this.receive(message, from));
  }
  onChange(handler: (rows: readonly ChatMessage[]) => void): void { this.listeners.push(handler); }
  send(value: string): boolean {
    const text = chatText(value);
    if (!text || !this.consume(this.transport.clientId)) return false;
    if (this.role === 'host') this.publish(this.transport.clientId, text);
    else this.transport.send({ k: 'chat-send', text });
    return true;
  }
  private consume(id: string): boolean {
    const now = this.clock(), budget = this.budgets.get(id) ?? { tokens: 3, at: now };
    budget.tokens = Math.min(3, budget.tokens + Math.max(0, now - budget.at) / 1000); budget.at = now;
    this.budgets.set(id, budget);
    if (budget.tokens < 1) return false;
    budget.tokens--; return true;
  }
  private publish(from: string, text: string): void {
    const name = this.members.get(from); if (!name) return;
    const row: ChatMessage = { id: ++this.seq, name, text, from };
    this.accept([row]); this.transport.send({ k: 'chat', row });
  }
  private receive(message: NetMessage, from: string): void {
    if (this.role === 'host') {
      if (!this.members.has(from)) return;
      if (message.k === 'chat-send') {
        const text = chatText(message.text);
        if (text && this.consume(from)) this.publish(from, text);
      } else if (message.k === 'chat-history' && this.clock() - (this.historyAt.get(from) ?? -Infinity) >= 2000) {
        this.historyAt.set(from, this.clock());
        this.transport.send({ k: 'chat-history', to: from, rows: this.history });
      }
      return;
    }
    if (from !== this.hostId) return;
    if (message.k === 'chat') this.accept([message.row]);
    else if (message.k === 'chat-history' && message.to === this.transport.clientId && Array.isArray(message.rows)) this.accept(message.rows.slice(-CHAT_HISTORY));
    else if (message.k === 'resume-state' && message.to === this.transport.clientId) this.transport.send({ k: 'chat-history' });
  }
  private accept(rows: unknown[]): void {
    let changed = false;
    for (const value of rows) {
      if (!value || typeof value !== 'object') continue;
      const row = value as ChatMessage;
      if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.from !== 'string'
        || !this.members.has(row.from) || !chatText(row.text) || this.history.some(previous => previous.id === row.id)) continue;
      this.history.push({ id: row.id, from: row.from, name: this.members.get(row.from)!, text: chatText(row.text) }); changed = true;
    }
    if (!changed) return;
    this.history.sort((a, b) => a.id - b.id);
    if (this.history.length > CHAT_HISTORY) this.history.splice(0, this.history.length - CHAT_HISTORY);
    for (const listener of this.listeners) listener(this.history);
  }
}
