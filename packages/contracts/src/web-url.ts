// The web screen URL rule (B30 R2). `is_web_screen_url` in crates/contracts is the same rule;
// fixtures/protocol/web-urls.json pins both.
const privateIpv4 = (parts: readonly number[]) => {
    const [a, b] = parts as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
};
const ipv4 = (host: string) => {
    const parts = host.split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part)) ? parts.map(Number) : null;
};
// The WHATWG parser gives a canonical IPv6 host: lowercase hex groups, at most one `::`,
// and an IPv4-mapped tail as hex (`::ffff:7f00:1`).
const ipv6Groups = (host: string): number[] | null => {
    const [head = '', tail] = host.split('::');
    const groups = (text: string) => text === '' ? [] : text.split(':').map(group => parseInt(group, 16));
    const start = groups(head), end = tail === undefined ? [] : groups(tail);
    return tail === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill(0), ...end];
};
const privateIpv6 = (host: string) => {
    const g = ipv6Groups(host);
    if (!g || g.length !== 8) return true;
    const zeroHead = g.slice(0, 5).every(n => n === 0);
    if (g.every(n => n === 0) || (g.slice(0, 7).every(n => n === 0) && g[7] === 1)) return true;
    if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80) return true;
    return zeroHead && g[5] === 0xffff && privateIpv4([g[6]! >> 8, g[6]! & 0xff]);
};
export const isWebScreenUrl = (value: string): boolean => {
    if (value.length < 12 || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value) || !value.startsWith('https://') || value[8] === '/') return false;
    let parsed: URL;
    try { parsed = new URL(value); } catch { return false; }
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return false;
    const host = parsed.hostname;
    if (host.startsWith('[')) return !privateIpv6(host.slice(1, -1));
    const v4 = ipv4(host);
    if (v4) return !privateIpv4(v4);
    const name = host.replace(/\.+$/, '');
    return name !== '' && name !== 'localhost' && !name.endsWith('.localhost') && !name.endsWith('.local');
};
