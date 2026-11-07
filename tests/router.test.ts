import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoute, listPage, navigate, closeRoute, updateQuery } from '../src/router';

afterEach(() => vi.unstubAllGlobals());
describe('URL routing', () => {
  it('resolves menu pages and nested screens', () => {
    for (const page of ['practice', 'questions', 'favorites', 'history', 'settings']) expect(parseRoute('/' + page)).toEqual({ page });
    expect(parseRoute('/')).toEqual({ page: 'practice' });
    for (const view of ['new', 'import', 'collections']) expect(parseRoute('/questions/' + view)).toEqual({ page: 'questions', view });
    expect(parseRoute('/favorites/' + encodeURIComponent('日本語/a ?#%') + '/edit')).toEqual({ page: 'favorites', view: 'edit', id: '日本語/a ?#%' });
    expect(parseRoute('/questions/new/edit/')).toEqual({ page: 'questions', view: 'edit', id: 'new' });
  });
  it('rejects unknown and malformed routes without opening practice', () => {
    for (const path of ['/unknown', '/settings/new', '/favorites/import', '/questions/%ZZ/edit', '/questions/a/edit/more']) expect(parseRoute(path).page).toBe('not-found');
  });
  it('validates page numbers', () => {
    for (const value of ['0', '-1', '1.5', 'Infinity', 'oops', '']) expect(listPage(new URLSearchParams({ page: value }))).toBe(1);
    expect(listPage(new URLSearchParams('page=2'))).toBe(2);
    expect(listPage(new URLSearchParams('page=9999999'))).toBe(1000000);
  });
  it('preserves filters, separates unclassified from all, and resets pagination', () => {
    const loc = new URL('http://localhost/questions?search=mountain&page=3');
    const pushState = vi.fn((state, unused, path) => { const next = new URL(path, loc); loc.href = next.href; });
    vi.stubGlobal('location', loc);
    vi.stubGlobal('window', { history: { pushState, replaceState: pushState }, dispatchEvent: vi.fn() });
    updateQuery({ collection: '', page: null });
    expect(loc.searchParams.get('collection')).toBe('');
    expect(loc.searchParams.get('search')).toBe('mountain');
    expect(loc.searchParams.has('page')).toBe(false);
    updateQuery({ collection: null });
    expect(loc.searchParams.has('collection')).toBe(false);
    updateQuery({ search: '日本語 &/#+', page: '2' }, true);
    expect(loc.searchParams.get('search')).toBe('日本語 &/#+');
    expect(loc.searchParams.get('page')).toBe('2');
  });
  it('uses history for internal dialogs and parent for direct links', () => {
    vi.stubGlobal('location', new URL('http://localhost/questions/new'));
    const back = vi.fn(), replaceState = vi.fn(), dispatchEvent = vi.fn();
    const history = { state: { quizModal: true } as { quizModal: boolean } | null, back, replaceState };
    vi.stubGlobal('window', { history, dispatchEvent });
    closeRoute('/questions?search=test'); expect(back).toHaveBeenCalledOnce();
    history.state = null;
    closeRoute('/questions?search=test'); expect(replaceState).toHaveBeenCalledWith(null, '', '/questions?search=test');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    navigate('/questions/new'); expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
