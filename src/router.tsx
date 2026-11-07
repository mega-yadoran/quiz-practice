import React, { useSyncExternalStore } from 'react';

export type Page = 'practice' | 'questions' | 'favorites' | 'history' | 'settings';
export type Route = { page: Page | 'not-found'; view?: 'new' | 'edit' | 'import' | 'collections'; id?: string };
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { page: 'practice' };
  const match = /^\/(practice|questions|favorites|history|settings)(?:\/(.*))?$/.exec(path);
  if (!match) return { page: 'not-found' };
  const page = match[1] as Page;
  const rest = match[2];
  if (!rest) return { page };
  if (page === 'questions' && ['new', 'import', 'collections'].includes(rest)) return { page, view: rest as Route['view'] };
  if (page === 'questions' || page === 'favorites') {
    const edit = /^([^/]+)\/edit$/.exec(rest);
    if (edit) {
      try { const id = decodeURIComponent(edit[1]); if (id && id.length <= 100) return { page, view: 'edit', id }; } catch {}
    }
  }
  return { page: 'not-found' };
}
export function listPage(params: URLSearchParams): number {
  const value = Number(params.get('page'));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 1000000) : 1;
}
const event = 'quiz:navigate';
export function navigate(to: string, replace = false, modal = false) {
  if (to === location.pathname + location.search) return;
  window.history[replace ? 'replaceState' : 'pushState'](modal ? { quizModal: true } : null, '', to);
  window.dispatchEvent(new Event(event));
}
export function closeRoute(parent: string) {
  if (window.history.state?.quizModal) window.history.back();
  else navigate(parent, true);
}
function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener); window.addEventListener(event, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(event, listener); };
}
export function useRoute() {
  const url = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const parsed = new URL(url, location.origin);
  return { ...parseRoute(parsed.pathname), pathname: parsed.pathname, params: parsed.searchParams, search: parsed.search };
}
export function Link({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} href={href} onClick={e => {
    props.onClick?.(e);
    if (!e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (!props.target || props.target === '_self') && !props.download) {
      e.preventDefault(); navigate(href);
    }
  }}>{children}</a>;
}
export function updateQuery(changes: Record<string, string | null>, replace = false) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '') params.delete(key); else params.set(key, value);
  }
  // Empty collection means unclassified; absence means all collections.
  if (changes.collection === '') params.set('collection', '');
  const query = params.toString();
  navigate(location.pathname + (query ? '?' + query : ''), replace);
}
