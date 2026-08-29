const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const { IgnorePlugin } = require('webpack');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    // Optional packages that pg and bullmq reference but never require unless you opt in:
    // pg-native for libpq bindings, @valkey/valkey-glide for the Valkey client. Webpack resolves
    // those references statically and warns because neither is installed. Both are guarded at the
    // call site, so ignoring them changes no behaviour — and it keeps a genuine warning from being
    // lost among two that appear on every single build.
    //
    // This has to be a plugin rather than an `externals` entry: NxAppWebpackPlugin overwrites
    // `externals`, so setting it there silently does nothing.
    new IgnorePlugin({ resourceRegExp: /^pg-native$|^@valkey\/valkey-glide$/ }),
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
