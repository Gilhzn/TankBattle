import { app } from './store.js';

export type Cleanup = (() => void) | void;
export type ScreenFn = (root: HTMLElement, params: Record<string, string>) => Cleanup | Promise<Cleanup>;

interface Route {
  pattern: string;
  parts: string[];
  screen: ScreenFn;
  name: string;
}

const routes: Route[] = [];
let current: { cleanup: Cleanup; name: string } | null = null;
let root: HTMLElement | null = null;
let notFound: ScreenFn | null = null;

export function route(pattern: string, name: string, screen: ScreenFn): void {
  routes.push({ pattern, parts: pattern.split('/').filter(Boolean), screen, name });
}

export function setNotFound(fn: ScreenFn): void {
  notFound = fn;
}

export function currentPath(): string {
  const hash = location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/' + hash;
}

export function navigate(path: string, replace = false): void {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === target) {
    void render();
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}

function match(path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
      else if (p !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

let rendering: Promise<void> | null = null;

export async function render(): Promise<void> {
  if (!root) return;
  if (rendering) await rendering;
  rendering = (async () => {
    const path = currentPath();
    const m = match(path);
    if (current) {
      try {
        current.cleanup?.();
      } catch (e) {
        console.error(e);
      }
      current = null;
    }
    while (root!.firstChild) root!.removeChild(root!.firstChild);
    window.scrollTo(0, 0);
    const name = m?.route.name ?? 'notfound';
    app.set({ screen: name });
    document.documentElement.dataset.screen = name;
    const fn = m?.route.screen ?? notFound;
    if (!fn) return;
    const params = m?.params ?? {};
    try {
      const cleanup = await fn(root!, params);
      current = { cleanup, name };
    } catch (e) {
      console.error('screen failed', e);
    }
  })();
  await rendering;
  rendering = null;
}

export function startRouter(el: HTMLElement): void {
  root = el;
  window.addEventListener('hashchange', () => void render());
  void render();
}
