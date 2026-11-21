export type SearchKeyAction = 'clear' | 'blur' | 'ignore';

export function searchEscape(value: string, key: string): SearchKeyAction {
  if (key !== 'Escape') return 'ignore';
  return value === '' ? 'blur' : 'clear';
}
