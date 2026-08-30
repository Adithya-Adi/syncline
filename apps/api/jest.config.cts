/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    // The source uses ESM-style '.js' specifiers because tsconfig is nodenext. Jest resolves
    // CommonJS, so it needs those pointed back at the '.ts' files.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Workspace packages resolve through a custom export condition that jest does not apply.
    '^@syncline/protocol$': '<rootDir>/../../packages/protocol/src/index.ts',
    '^@syncline/models$': '<rootDir>/../../packages/models/src/index.ts',
  },
  coverageDirectory: 'test-output/jest/coverage',
};
