import { cookies } from 'next/headers';
import { db } from './db';

/**
 * Who is making the request, for code that runs outside a server action.
 *
 * The member mutations — invite, cancel, re-role, remove — are Better Auth endpoints called from
 * the browser, so the only server-side seam is Better Auth's own `organizationHooks`. Those hand
 * over the member and the organization but not the person doing it, which is the one field an
 * audit entry cannot do without: "someone was demoted" is not a record of anything.
 *
 * So the session is resolved here from the cookie. Deliberately not through `auth.api.getSession`:
 * the hooks live in `auth.ts`, and reaching back into it from something `auth.ts` imports is a
 * cycle. Reading the row is what `getSession` does anyway, minus the parts about refreshing it.
 */

export interface AuditActor {
  id: string | null;
  email: string;
  name: string;
}

/** What is recorded when the cookie is missing or stale. Never left blank — a blank actor reads
 * as a bug rather than as an unattributed action. */
const UNKNOWN: AuditActor = { id: null, email: 'unknown', name: 'Unknown' };

/**
 * Better Auth signs its session cookie as `<token>.<signature>` and stores only the token. The
 * signature is what makes the cookie unforgeable in transit; the lookup below is what makes it
 * useless without a matching row, which is the check that actually matters here.
 */
function tokenFrom(raw: string): string {
  const dot = raw.indexOf('.');
  return dot === -1 ? raw : raw.slice(0, dot);
}

export async function currentAuditActor(): Promise<AuditActor> {
  try {
    const jar = await cookies();

    // The `__Secure-` prefix is added whenever the cookie is issued over HTTPS, so both names have
    // to be tried — checking only one silently loses every actor in production, or every actor in
    // development, depending which one was written down.
    const raw =
      jar.get('better-auth.session_token')?.value ??
      jar.get('__Secure-better-auth.session_token')?.value;

    if (!raw) return UNKNOWN;

    const session = await db.authSession.findFirst({
      where: { token: tokenFrom(raw), expiresAt: { gt: new Date() } },
      select: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!session) return UNKNOWN;

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  } catch {
    // Outside a request — a hook fired from a script, say. An entry attributed to nobody is worth
    // more than no entry, and far more than a thrown error inside somebody's sign-out.
    return UNKNOWN;
  }
}
