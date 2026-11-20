import { mount } from 'svelte';
import '../src/app.css';
import ColorFieldHarness from './ColorFieldHarness.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('missing app root');
mount(ColorFieldHarness, { target });
