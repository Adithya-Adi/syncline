/**
 * Where an invitation link points.
 *
 * Built in the browser from the origin actually being used rather than from a configured base URL.
 * A self-hosted install is reached by whatever hostname its operator chose — often several — and a
 * link built from the wrong one is worse than no link at all.
 */
export function invitationUrl(invitationId: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/accept-invitation/${invitationId}`;
}
