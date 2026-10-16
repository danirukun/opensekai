import { qualityProfileFromQuery, type ConnectionDescriptor } from '@opensekai/contracts';
import { expect, it } from 'vitest';
import { makeOutputUrl, withQualityProfile } from '../src/editor/output-url';
const descriptor = { httpOrigin: 'http://127.0.0.1:1234', ticket: 'test-only' } as ConnectionDescriptor;
const profileOf = (url: string) => qualityProfileFromQuery(new URL(url).searchParams.get('quality')).id;
it('adds the quality parameter only for a profile other than production and keeps the descriptor hash', () => {
 const base = makeOutputUrl(descriptor, 'auto');
 expect(withQualityProfile(base, 'production_v1')).toBe(base);
 const performance = withQualityProfile(base, 'performance_v1');
 expect(new URL(performance).searchParams.get('quality')).toBe('performance_v1');
 expect(profileOf(performance)).toBe('performance_v1');
 expect(JSON.parse(decodeURIComponent(new URL(performance).hash.slice(1)))).toEqual(descriptor);
 expect(withQualityProfile(performance, 'production_v1')).toBe(base);
});
it('keeps the backend parameter next to the quality parameter', () => {
 const url = new URL(withQualityProfile(makeOutputUrl(descriptor, 'force-webgl2'), 'preview_v1'));
 expect(url.searchParams.get('backend')).toBe('webgl2');
 expect(url.searchParams.get('quality')).toBe('preview_v1');
 expect(profileOf(url.toString())).toBe('preview_v1');
});
it('leaves an empty URL empty', () => { expect(withQualityProfile('', 'performance_v1')).toBe(''); });
