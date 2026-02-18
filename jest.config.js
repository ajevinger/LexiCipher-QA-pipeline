'use strict';
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true,
  // Ignore the nested duplicate folder that causes haste-map naming collision
  modulePathIgnorePatterns: ['<rootDir>/LexiCipher QA pipeline/'],
};
