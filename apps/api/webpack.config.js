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
    // The `pg` package references an optional native binding that only loads if you explicitly
    // opt into it. Webpack resolves that reference statically and warns because the package is
    // not installed. `pg` guards the require in a try/catch, so ignoring it changes no behaviour,
    // and it keeps a genuine warning from being lost in recurring noise.
    //
    // This has to be a plugin rather than an `externals` entry: NxAppWebpackPlugin overwrites
    // `externals`, so setting it there silently does nothing.
    new IgnorePlugin({ resourceRegExp: /^pg-native$/ }),
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
