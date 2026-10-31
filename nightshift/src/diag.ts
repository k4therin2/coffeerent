/**
 * Connection / event log. The "server" is the host's browser, so this is the
 * closest thing to server logs: a ring buffer kept in memory and localStorage,
 * viewable from the lobby and results screens and copyable for bug reports.
 */
export interface DiagLine { t: string; level: 'info' | 'warn' | 'error'; msg: string }
const MAX = 400;
const KEY = 'ns-diag';
let lines: DiagLine[] = [];
try { lines = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { lines = []; }
const listeners = new Set<() => void>();

function stamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
export function diag(msg: string, level: DiagLine['level'] = 'info') {
  const line = { t: stamp(), level, msg };
  lines.push(line);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX))); } catch { /* storage full or blocked */ }
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[nightshift]', line.t, msg);
  for (const l of listeners) l();
}
export function diagLines(): DiagLine[] { return lines; }
export function onDiag(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
export function diagText(): string {
  return lines.map(l => `${l.t} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n');
}
export function clearDiag() { lines = []; try { localStorage.removeItem(KEY); } catch { /* ignore */ } for (const l of listeners) l(); }
diag(`page loaded · ${navigator.userAgent}`);
