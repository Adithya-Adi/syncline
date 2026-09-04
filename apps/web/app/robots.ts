import type { MetadataRoute } from 'next';
import { SITE, PUBLIC_PATHS } from '@/lib/site';

/**
 * What a crawler may read.
 *
 * Only the landing page and the docs. Everything else is either behind a session — where a crawler
 * gets a redirect to sign-in and nothing else — or is a page whose whole content is one customer's
 * data. Neither belongs in an index, and `/s/` in particular is a recording's permalink: those
 * URLs are shared into chat apps and issue trackers, and a search engine holding them is a way for
 * one customer's session to surface outside their organization.
 *
 * `/api/` is disallowed because the auth endpoints live under it. Nothing there renders.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_PATHS],
      disallow: [
        '/api/',
        '/dashboard',
        '/projects',
        '/sessions',
        '/members',
        '/audit',
        '/organizations',
        '/accept-invitation',
        '/s/',
        '/sign-in',
        '/sign-up',
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
