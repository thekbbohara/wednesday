export const PAGE_IDS = ['command', 'skills', 'tasks', 'memory', 'credits', 'plan', 'settings'] as const;
export type PageId = typeof PAGE_IDS[number];

export function pageFromUrl(url: Pick<URL, 'pathname' | 'hash'>): PageId {
  const hash = url.hash.replace(/^#\/?/, '');
  if (PAGE_IDS.some(p => p === hash)) return hash as PageId;
  return url.pathname.replace(/\/$/, '') === '/usages' ? 'credits' : 'command';
}

export function pageUrl(page: PageId, search = ''): string {
  return page === 'credits' ? `/usages${search}` : `/${search}${page === 'command' ? '' : `#/${page}`}`;
}
