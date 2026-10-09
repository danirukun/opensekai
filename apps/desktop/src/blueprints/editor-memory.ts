import type { BlueprintClipboard } from './clipboard';
import { createUndoHistory, type UndoHistory } from './undo';

// Lives with the sync, so it survives switching editor panels.
export interface EditorMemory { history: UndoHistory; clipboard: { current: BlueprintClipboard | null }; seen: { revision: number } }
export const createEditorMemory = (): EditorMemory => ({ history: createUndoHistory(), clipboard: { current: null }, seen: { revision: 0 } });
