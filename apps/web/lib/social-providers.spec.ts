import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configuredSocialProviders,
  enabledSocialProviders,
} from './social-providers';

// Cleared, not assumed absent: these are real variable names, and a developer with one exported
// in their shell would otherwise get different results than CI.
const VARIABLES = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITLAB_CLIENT_ID',
  'GITLAB_CLIENT_SECRET',
  'GITLAB_ISSUER',
];

beforeEach(() => {
  for (const variable of VARIABLES) vi.stubEnv(variable, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('enabledSocialProviders', () => {
  it('offers nothing when nothing is configured', () => {
    expect(enabledSocialProviders()).toEqual([]);
    expect(configuredSocialProviders()).toEqual({});
  });

  it('offers a provider once both halves of its pair are set', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', 'id');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'secret');

    expect(enabledSocialProviders()).toEqual([
      { id: 'github', label: 'GitHub' },
    ]);
  });

  it('keeps a half-configured provider off', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');

    expect(enabledSocialProviders()).toEqual([]);
  });

  it('treats whitespace as unset', () => {
    // `GOOGLE_CLIENT_SECRET=` in a compose file arrives as an empty string, not as undefined.
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '   ');

    expect(enabledSocialProviders()).toEqual([]);
  });
});

describe('configuredSocialProviders', () => {
  it('hands Better Auth only the providers that have credentials', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');

    expect(configuredSocialProviders()).toEqual({
      google: { clientId: 'google-id', clientSecret: 'google-secret' },
    });
  });

  it('points GitLab at a self-hosted instance when one is named', () => {
    vi.stubEnv('GITLAB_CLIENT_ID', 'id');
    vi.stubEnv('GITLAB_CLIENT_SECRET', 'secret');
    vi.stubEnv('GITLAB_ISSUER', 'https://gitlab.example.com');

    expect(configuredSocialProviders()).toEqual({
      gitlab: {
        clientId: 'id',
        clientSecret: 'secret',
        issuer: 'https://gitlab.example.com',
      },
    });
  });

  it('leaves GitLab on gitlab.com when no issuer is named', () => {
    vi.stubEnv('GITLAB_CLIENT_ID', 'id');
    vi.stubEnv('GITLAB_CLIENT_SECRET', 'secret');

    expect(configuredSocialProviders()).toEqual({
      gitlab: { clientId: 'id', clientSecret: 'secret' },
    });
  });
});
