import { describe, expect, it } from 'vitest';
import { pageFromUrl, pageUrl, PAGE_IDS } from './routes';

describe('usage page navigation', () => {
  it('opens the dedicated route directly and retains legacy hashes', () => {
    expect(pageFromUrl(new URL('http://localhost/usages'))).toBe('credits');
    expect(pageFromUrl(new URL('http://localhost/usages/'))).toBe('credits');
    expect(pageFromUrl(new URL('http://localhost/#/credits'))).toBe('credits');
    expect(pageFromUrl(new URL('http://localhost/#/settings'))).toBe('settings');
    expect(pageFromUrl(new URL('http://localhost/unknown'))).toBe('command');
  });
  it('keeps page identity on refresh and produces a clean URL when leaving usages', () => {
    for (const p of PAGE_IDS) expect(pageFromUrl(new URL(pageUrl(p, '?review=t48'), 'http://localhost'))).toBe(p);
    expect(pageUrl('credits')).toBe('/usages');
    expect(pageUrl('settings')).toBe('/#/settings');
    expect(pageUrl('command')).toBe('/');
  });
});
