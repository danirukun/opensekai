import type { BlueprintClipboard } from './clipboard';
import { createPalettePrefs, type PalettePrefs } from './palette-prefs';
import { createUndoHistory, type UndoHistory } from './undo';

// Lives with the sync, so it survives switching editor panels. The palette state is per user and also survives a restart.
export interface EditorMemory { history: UndoHistory; clipboard: { current: BlueprintClipboard | null }; seen: { revision: number }; palette: PalettePrefs }
export const createEditorMemory = (palette: PalettePrefs = createPalettePrefs()): EditorMemory => ({ history: createUndoHistory(), clipboard: { current: null }, seen: { revision: 0 }, palette });
