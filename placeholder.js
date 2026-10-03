// Sections that exist in the navigation but are built in a later update.
import { html, mount, emptyHtml } from './ui.js';

export const placeholder = (main, title, text) =>
  mount(main, html`<header class="page-head"><h1>${title}</h1></header>${emptyHtml('Not built yet', text, html`<p><a class="btn" href="#/tasks">Back to tasks</a></p>`)}`);
