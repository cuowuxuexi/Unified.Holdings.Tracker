module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Optional: setup file for global mocks or setup
  // setupFilesAfterEnv: ['./src/setupTests.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};