// Tiny hash router, so the app works on any static host without server rules.
const routes = [];
const hooks = [];

export function route(pattern, section, handler) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ re, section, handler });
}
export function onRoute(fn) { hooks.push(fn); }

export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/dashboard';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path, query };
}

export function navigate(hash) {
  if (location.hash === hash) dispatch(); else location.hash = hash;
}

export function start() {
  // First load: always begin on a real route, whatever else is in the address (blank, #main, an email-link token).
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
  window.removeEventListener('hashchange', dispatch);
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}

let navigation = 0;
export async function dispatch() {
  // Ignore hashes that are not app routes, such as the skip link (#main) or sign-in tokens from an email link.
  if (location.hash && !location.hash.startsWith('#/')) return;
  const { path, query } = parseHash();
  const frame = document.getElementById('main');
  if (!frame) return;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    hooks.forEach((h) => h(r.section));
    // Each navigation gets its own container. A screen that is slow to load can then never paint over
    // a screen the person has since moved to: it just fills a container that is no longer on the page.
    const mine = ++navigation;
    const main = document.createElement('div');
    main.className = 'view';
    frame.replaceChildren(main);
    try {
      await r.handler(main, { ...(m.groups || {}) }, query);
    } catch (err) {
      console.error(err);
      if (mine === navigation) {
        const { errorHtml, mount } = await import('./ui.js');
        mount(main, errorHtml(err.message || 'Something went wrong.'));
      }
    }
    if (mine === navigation) window.scrollTo?.(0, 0);
    return;
  }
  navigate('#/dashboard');
}
