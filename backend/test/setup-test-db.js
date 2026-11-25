/* eslint-disable */
// Applies pending Prisma migrations to the dedicated test database before e2e tests run.
// Non-destructive (`migrate deploy`); the tests themselves truncate tables between cases.
const { execSync } = require('child_process');
const { TEST_DATABASE_URL } = require('./test-env.js');

if (!/_test\b/.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error(`Refusing to run e2e tests against a non-test database: ${TEST_DATABASE_URL}`);
}

execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});
