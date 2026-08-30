'use client';

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

/**
 * Browser-side auth. Same origin as the app, so no base URL is needed — and not configuring one
 * means a self-hosted install works on whatever hostname it is served from.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
