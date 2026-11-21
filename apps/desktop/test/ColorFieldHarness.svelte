<script lang="ts">
 import ColorField from '../src/components/ColorField.svelte';
 type Call = { kind: 'live' | 'end' | 'commit'; value?: string; at: number };
 type Host = { apply: boolean; reject: boolean };
 const page = window as unknown as { __calls: Call[]; __host: Host; __setValue: (next: string) => void };
 page.__calls = [];
 page.__host = { apply: true, reject: false };
 let value = $state('#ff0000');
 page.__setValue = next => { value = next; };
 const record = (kind: Call['kind'], next?: string) => page.__calls.push({ kind, value: next, at: performance.now() });
 // The stand-in host applies a color 20 ms later, as a scene reply does. A rejected commit changes nothing.
 const later = (next: string) => setTimeout(() => { if (page.__host.apply) value = next; }, 20);
</script>
<ColorField label="Color" {value}
 onlive={next => { record('live', next); later(next); }}
 onend={() => record('end')}
 oncommit={next => { record('commit', next); if (!page.__host.reject) later(next); }} />
<p data-testid="scene">{value}</p>
