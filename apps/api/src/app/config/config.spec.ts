import { loadConfig } from './config.js';

const VALID = {
  DATABASE_URL: 'postgresql://syncline:syncline@localhost:5432/syncline',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'syncline',
  S3_ACCESS_KEY_ID: 'syncline',
  S3_SECRET_ACCESS_KEY: 'syncline-dev-secret',
};

describe('loadConfig', () => {
  it('applies defaults for everything optional', () => {
    const config = loadConfig(VALID);
    expect(config.API_PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.S3_REGION).toBe('us-east-1');
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('coerces numbers and booleans out of the strings the environment gives us', () => {
    const config = loadConfig({ ...VALID, API_PORT: '8080', S3_FORCE_PATH_STYLE: 'false' });
    expect(config.API_PORT).toBe(8080);
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('names the missing variable, so the failure is actionable at 3am', () => {
    const { DATABASE_URL, ...missing } = VALID;
    expect(() => loadConfig(missing)).toThrow(/DATABASE_URL/);
  });

  it('reports every problem at once rather than one per restart', () => {
    const { DATABASE_URL, REDIS_URL, ...missing } = VALID;
    const error = (() => {
      try {
        loadConfig(missing);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error?.message).toMatch(/DATABASE_URL/);
    expect(error?.message).toMatch(/REDIS_URL/);
  });

  it('rejects a port that is not a port', () => {
    expect(() => loadConfig({ ...VALID, API_PORT: 'yes' })).toThrow(/API_PORT/);
  });
});
