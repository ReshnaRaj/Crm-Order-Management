// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TEST_ENV } = require('./test-env.js') as { TEST_ENV: Record<string, string> };

Object.assign(process.env, TEST_ENV);
