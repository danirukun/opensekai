import { mount } from 'svelte';
import EditorApp from './EditorApp.svelte';
import './app.css';
import { startTheme } from './editor/theme.svelte';
startTheme();
mount(EditorApp, { target: document.getElementById('app')! });
