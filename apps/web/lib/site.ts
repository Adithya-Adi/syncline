/**
 * Where this install lives, and which of its pages are public.
 *
 * One definition, read by the metadata, the sitemap and robots.txt. Three copies of a hostname is
 * how a canonical URL ends up pointing at a domain the install does not answer on.
 *
 * `NEXT_PUBLIC_SITE_URL` is what a self-hosted install sets. The localhost fallback keeps
 * development working and is also the honest answer for an install that never set it — a wrong
 * absolute URL in a canonical tag is worse than an obviously local one.
 */
export const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

export const TAGLINE = 'Every layer of your stack, folded onto one timeline.';

/**
 * The pages a crawler may have, and the only ones in the sitemap.
 *
 * Everything absent from this list is behind a session or is one customer's data. Adding a public
 * page means adding it here — which is deliberate: the default for a new route is not indexed.
 */
export const PUBLIC_PATHS = [
  '/',
  '/docs',
  '/docs/quickstart',
  '/docs/browser-sdk',
  '/docs/backend',
  '/docs/architecture',
  '/docs/self-hosting',
  '/docs/privacy',
] as const;
