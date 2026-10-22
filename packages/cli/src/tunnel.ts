import { WebSocket } from 'ws';
import type { Headers } from './store.js';

export interface RelayRequest {
  type: 'request';
  eventId: string;
  method: string;
  path: string;
  query: string;
  headers: Headers;
  bodyBase64: string;
  receivedAt?: number;
}

export interface RelayResponse {
  type: 'response';
  eventId: string;
  status: number;
  headers: Headers;
  bodyBase64: string;
}

export type TunnelState = 'connecting' | 'connected' | 'disconnected';

export interface TunnelOptions {
  relay: string;
  id: string;
  token: string;
  onRequest: (req: RelayRequest) => Promise<RelayResponse>;
  onState: (s: TunnelState) => void;
}

/** WebSocket client with exponential backoff reconnect. */
export class TunnelClient {
  private ws?: WebSocket;
  private stopped = false;
  private attempt = 0;
  private timer?: NodeJS.Timeout;
  state: TunnelState = 'connecting';

  constructor(private o: TunnelOptions) {}

  start(): void {
    this.connect();
  }

  private setState(s: TunnelState) {
    if (this.state !== s) {
      this.state = s;
      this.o.onState(s);
    }
  }

  private connect() {
    if (this.stopped) return;
    this.setState('connecting');
    const url = new URL(this.o.relay);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/tunnel';
    url.search = new URLSearchParams({ id: this.o.id, token: this.o.token }).toString();
    const ws = new WebSocket(url.toString());
    this.ws = ws;
    ws.on('open', () => {
      this.attempt = 0;
      this.setState('connected');
    });
    ws.on('message', (data) => {
      let msg: RelayRequest;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type !== 'request') return;
      this.o
        .onRequest(msg)
        .then((res) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(res));
        })
        .catch(() => undefined);
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (this.ws === ws) this.setState('disconnected');
      if (this.stopped) return;
      const delay = Math.min(15_000, 500 * 2 ** this.attempt++);
      this.timer = setTimeout(() => this.connect(), delay);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.terminate();
  }
}
