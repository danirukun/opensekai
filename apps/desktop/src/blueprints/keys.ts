import { isMac } from './keystroke-format';

export type ShortcutAction = 'delete' | 'copy' | 'paste' | 'duplicate' | 'selectAll' | 'undo' | 'redo' | 'escape';
export interface KeyInput { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null }
const typing = (target: EventTarget | null) => {
 const element = target as { tagName?: string; isContentEditable?: boolean } | null;
 return !!element && (element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(element.tagName).toUpperCase()));
};
const COMMANDS: Record<string, ShortcutAction> = { c: 'copy', v: 'paste', d: 'duplicate', a: 'selectAll' };
export function shortcutFor(event: KeyInput, platform: string): ShortcutAction | null {
 if (typing(event.target)) return null;
 const command = isMac(platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
 if (!command && !event.metaKey && !event.ctrlKey && !event.altKey) {
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';
  return event.key === 'Escape' ? 'escape' : null;
 }
 if (!command || event.altKey) return null;
 const key = event.key.toLowerCase();
 if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
 return event.shiftKey ? null : COMMANDS[key] ?? null;
}
