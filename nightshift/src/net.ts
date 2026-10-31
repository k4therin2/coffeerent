import Peer, { type DataConnection } from 'peerjs';
import type { ClientMsg, HostMsg } from './types';
import { diag } from './diag';

const PREFIX = 'nightshift-cats-v1-';

export function randomCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)];
  return c;
}

/** A link from the host's point of view to one client. */
export interface ClientLink {
  id: string;
  send(m: HostMsg): void;
  onMessage: ((m: ClientMsg) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
}

/** A link from a client's point of view to the host. */
export interface HostLink {
  send(m: ClientMsg): void;
  onMessage: ((m: HostMsg) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
}

/** In process pair used so the host also plays as a normal client. */
export function loopback(): { client: HostLink; server: ClientLink } {
  const client: HostLink = {
    onMessage: null, onClose: null,
    send: (m) => queueMicrotask(() => server.onMessage?.(m)),
    close: () => {},
  };
  const server: ClientLink = {
    id: 'host', onMessage: null, onClose: null,
    send: (m) => queueMicrotask(() => client.onMessage?.(m)),
    close: () => {},
  };
  return { client, server };
}

function wrapConn(conn: DataConnection): ClientLink & HostLink {
  const short = conn.peer.slice(-6);
  const link: any = {
    id: conn.peer,
    onMessage: null, onClose: null,
    send: (m: unknown) => { if (conn.open) conn.send(m); },
    close: () => { diag(`conn ${short}: closed by us`); conn.close(); },
  };
  conn.on('data', (d) => link.onMessage?.(d));
  conn.on('close', () => { diag(`conn ${short}: closed`, 'warn'); link.onClose?.('connection closed'); });
  conn.on('error', (e: any) => { diag(`conn ${short}: error ${e?.type ?? ''} ${e?.message ?? e}`, 'error'); link.onClose?.('connection error: ' + (e?.message ?? e)); });
  conn.on('iceStateChanged', (st) => {
    diag(`conn ${short}: ice ${st}`, st === 'failed' || st === 'disconnected' ? 'warn' : 'info');
    if (st === 'failed') link.onClose?.('network path failed');
  });
  diag(`conn ${short}: open (reliable=${conn.reliable}, serialization=${conn.serialization})`);
  return link;
}

export function hostRoom(code: string, onClient: (c: ClientLink) => void): Promise<Peer> {
  return new Promise((resolve, reject) => {
    diag(`host: opening room ${code}`);
    const peer = new Peer(PREFIX + code, { debug: 1 });
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; diag('host: signaling timeout', 'error'); peer.destroy(); reject(new Error('signaling timeout')); } }, 10000);
    peer.on('open', () => { if (!settled) { settled = true; clearTimeout(timer); diag(`host: room ${code} open on signaling server`); resolve(peer); } });
    peer.on('error', (e: any) => {
      diag(`host: peer error ${e?.type ?? ''} ${e?.message ?? e}`, settled ? 'warn' : 'error');
      if (!settled) { settled = true; clearTimeout(timer); peer.destroy(); reject(e); }
    });
    peer.on('disconnected', () => { diag('host: lost signaling server, reconnecting (existing players unaffected)', 'warn'); try { peer.reconnect(); } catch { /* destroyed */ } });
    peer.on('connection', (conn) => {
      conn.on('open', () => onClient(wrapConn(conn)));
    });
  });
}

export function joinRoom(code: string): Promise<{ peer: Peer; link: HostLink }> {
  return new Promise((resolve, reject) => {
    diag(`join: connecting to room ${code}`);
    const peer = new Peer({ debug: 1 });
    let settled = false;
    peer.on('open', () => {
      diag(`join: signaling ok as ${peer.id.slice(-6)}, dialing host`);
      const conn = peer.connect(PREFIX + code, { reliable: true });
      const timer = setTimeout(() => {
        if (!settled) { settled = true; diag('join: timed out dialing host', 'error'); peer.destroy(); reject(new Error('Could not reach that room. Check the code, or ask the host to re-host.')); }
      }, 12000);
      conn.on('open', () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        const link = wrapConn(conn);
        const close = link.close;
        link.close = () => { close(); peer.destroy(); };
        resolve({ peer, link });
      });
      conn.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); peer.destroy(); reject(e); } });
    });
    peer.on('error', (e: any) => {
      diag(`join: peer error ${e?.type ?? ''} ${e?.message ?? e}`, settled ? 'warn' : 'error');
      if (settled) return;
      settled = true; peer.destroy();
      reject(e?.type === 'peer-unavailable' ? new Error('No room with that code is open right now.') : e);
    });
    peer.on('disconnected', () => { diag('join: lost signaling server (game connection unaffected)', 'warn'); });
  });
}
