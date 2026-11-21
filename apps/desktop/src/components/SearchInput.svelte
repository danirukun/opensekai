<script lang="ts">
 import { Search } from '@lucide/svelte';
 import { searchEscape } from '../editor/search-field';

 let {
  value = $bindable(''),
  label,
  placeholder = 'Search',
  id,
  disabled = false,
  onkeydown,
 }: {
  value?: string;
  label: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  onkeydown?: (event: KeyboardEvent) => void;
 } = $props();

 function keydown(event: KeyboardEvent) {
  const action = searchEscape(value, event.key);
  if (action === 'clear') {
   value = '';
   event.preventDefault();
   event.stopPropagation();
   return;
  }
  if (action === 'blur' && event.currentTarget instanceof HTMLInputElement) event.currentTarget.blur();
  onkeydown?.(event);
 }
</script>

<div class="search-field">
 <Search size={14} aria-hidden="true" />
 <input {id} type="text" {placeholder} {disabled} autocomplete="off" spellcheck="false" aria-label={label} bind:value onkeydown={keydown} />
</div>

<style>
 .search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid var(--ds-color-border);
  border-radius: 4px;
  background: var(--ds-color-input);
  color: var(--ds-color-text-muted);
 }
 .search-field:has(input:disabled) { opacity: 0.6; }
 .search-field:has(input:focus-visible) {
  outline: 2px solid var(--ds-color-focus);
  outline-offset: 2px;
 }
 .search-field :global(svg) { flex: none; }
 .search-field input {
  flex: 1;
  min-width: 0;
  width: 100%;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 7px 0;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  color: var(--ds-color-text);
 }
 .search-field input:focus,
 .search-field input:focus-visible { outline: none; }
 .search-field input::placeholder {
  color: var(--ds-color-text-muted);
  opacity: 0.6;
 }
</style>
