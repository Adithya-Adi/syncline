//@ts-check

/**
 * The example runs on 4321 so it never collides with the dashboard on 3000. The port lives in the
 * Nx target rather than here, because Next takes it as a CLI flag.
 *
 * `transpilePackages` covers the SDK: it is a workspace package whose published entry point is an
 * ES module, and naming it here keeps Next from treating it as an opaque external.
 */
const nextConfig = {
  transpilePackages: ['syncline-browser'],
};

module.exports = nextConfig;
