// 收益计算基于本地时区日界（startOfDay），测试期望值按东八区推导；
// 固定 TZ 保证测试在任意机器/CI 时区下结果一致
process.env.TZ = 'Asia/Shanghai';

const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../tsconfig.base.json');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Optional: setup file for global mocks or setup
  // setupFilesAfterEnv: ['./src/setupTests.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  roots: ['<rootDir>/src'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json',
    },
  },
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths || {}, {
    prefix: '<rootDir>/../../',
  }),
  forceExit: true,
};
