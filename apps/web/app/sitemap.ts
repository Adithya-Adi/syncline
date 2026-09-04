import type { MetadataRoute } from 'next';
import { SITE, PUBLIC_PATHS } from '@/lib/site';

/**
 * The public pages, and nothing else.
 *
 * Read from the same list robots.txt allows, so the two cannot disagree — a sitemap advertising a
 * URL robots.txt forbids is a crawl error rather than a page anyone finds.
 *
 * No per-page `lastModified`: it would have to be either a build timestamp, which claims every page
 * changed on every deploy, or a hand-maintained date, which goes stale silently. Omitting it lets
 * the crawler use what it observes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: 'weekly',
    // The landing page is the entry point; the docs matter but rank below it.
    priority: path === '/' ? 1 : 0.7,
  }));
}
