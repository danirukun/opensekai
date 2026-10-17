import { ExpressionSettingsSchema, triggerableExpressions, type AssetRecord, type ExpressionSettings, type ExpressionView, type Id } from '@opensekai/contracts';

// The Inspector shows the Expressions group only when the model of the character has triggerable expressions.
export function hasTriggerableExpressions(assetId: Id | null, assets: readonly AssetRecord[]): boolean {
 const record = assetId === null ? undefined : assets.find(asset => asset.id === assetId);
 return record !== undefined && triggerableExpressions(record).length > 0;
}
export const LAYER_OPTIONS = Array.from({ length: 16 }, (_, layer) => ({ value: String(layer), label: String(layer) }));
export const settingsOf = (view: ExpressionView): ExpressionSettings => ({ layer: view.layer, fadeSeconds: view.fadeSeconds, suppress: { ...view.suppress } });
// A settings edit from one field, or null when the value is out of range.
export function editSettings(view: ExpressionView, edit: { layer?: string; fadeSeconds?: string; suppress?: Partial<ExpressionSettings['suppress']> }): ExpressionSettings | null {
 const base = settingsOf(view);
 const next = {
  layer: edit.layer === undefined ? base.layer : Number(edit.layer),
  fadeSeconds: edit.fadeSeconds === undefined ? base.fadeSeconds : edit.fadeSeconds.trim() === '' ? NaN : Number(edit.fadeSeconds),
  suppress: { ...base.suppress, ...edit.suppress },
 };
 const parsed = ExpressionSettingsSchema.safeParse(next);
 return parsed.success ? parsed.data : null;
}
