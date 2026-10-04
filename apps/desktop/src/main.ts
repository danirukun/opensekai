import { mount } from 'svelte';
import App from './App.svelte';
import EditorApp from './EditorApp.svelte';
import './app.css';
document.documentElement.dataset.theme='light';
mount(new URLSearchParams(location.search).get('view')==='editor'?EditorApp:App, { target: document.getElementById('app')! });
