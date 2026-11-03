import { mount } from 'svelte';
import EditorApp from './EditorApp.svelte';
import './app.css';
document.documentElement.dataset.theme='light';
mount(EditorApp, { target: document.getElementById('app')! });
