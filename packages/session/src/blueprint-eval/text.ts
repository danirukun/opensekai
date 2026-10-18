import type { ScalarValue } from '@opensekai/contracts';
import { formatTemplate, parseInteger, parseNumber, splitText, stringForm, substring } from './data-helpers';
import type { EvaluatorTable, Read } from './types';

const str = (read: Read, port: string) => read(port) as string;
const int = (read: Read, port: string) => read(port) as number;
const text = (read: Read) => str(read, 'text');

export const TEXT_EVALUATORS = {
 'text.concat': { data: (node, _o, read) => Array.from({ length: node.settings.count }, (_, i) => str(read, `text${i}`)).join('') },
 'text.format': { data: (node, _o, read) => formatTemplate(node.settings.template, node.settings.args.map((_, i) => read(`arg${i}`) as ScalarValue)) },
 'text.length': { data: (_n, _o, read) => text(read).length },
 'text.substring': { data: (_n, _o, read) => substring(text(read), int(read, 'start'), int(read, 'length')) },
 'text.contains': { data: (_n, _o, read) => text(read).includes(str(read, 'search')) },
 'text.startsWith': { data: (_n, _o, read) => text(read).startsWith(str(read, 'search')) },
 'text.endsWith': { data: (_n, _o, read) => text(read).endsWith(str(read, 'search')) },
 'text.replace': { data: (_n, _o, read) => { const search = str(read, 'search'), replacement = str(read, 'replacement'); return search === '' ? text(read) : text(read).replaceAll(search, () => replacement); } },
 'text.toUpper': { data: (_n, _o, read) => text(read).toUpperCase() },
 'text.toLower': { data: (_n, _o, read) => text(read).toLowerCase() },
 'text.trim': { data: (_n, _o, read) => text(read).trim() },
 'text.split': { data: (_n, _o, read) => splitText(text(read), str(read, 'separator')) },
 'text.join': { data: (_n, _o, read) => (read('items') as readonly string[]).join(str(read, 'separator')) },
 'text.equals': { data: (node, _o, read) => {
  const a = str(read, 'a'), b = str(read, 'b');
  return node.settings.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
 } },
 'text.toString': { data: (_n, _o, read) => stringForm(read('value') as ScalarValue) },
 'text.parseNumber': { data: (_n, output, read) => { const parsed = parseNumber(text(read)); return output === 'ok' ? parsed.ok : parsed.value; } },
 'text.parseInteger': { data: (_n, output, read) => { const parsed = parseInteger(text(read)); return output === 'ok' ? parsed.ok : parsed.value; } },
} satisfies Partial<EvaluatorTable>;
