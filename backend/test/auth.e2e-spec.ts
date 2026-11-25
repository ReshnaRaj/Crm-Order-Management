import { createTestApp, registerAndLogin, resetDatabase, TestContext } from './utils/test-app';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /api/auth/register', () => {
    it('registers a user, hashes the password and returns a token', async () => {
      const res = await ctx
        .http()
        .post('/api/auth/register')
        .send({ name: 'Jane', email: 'Jane@Example.com', password: 'Passw0rd!' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user).toMatchObject({ email: 'jane@example.com', role: 'ADMIN' });
      expect(res.body.data.user.passwordHash).toBeUndefined();

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'jane@example.com' } });
      expect(row.passwordHash).not.toContain('Passw0rd!');
      expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    });

    it('makes only the first user an admin', async () => {
      await registerAndLogin(ctx);
      const { user } = await registerAndLogin(ctx);
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.role).toBe('USER');
    });

    it('rejects duplicate emails with 409', async () => {
      await registerAndLogin(ctx, { email: 'dup@example.com' });
      const res = await ctx
        .http()
        .post('/api/auth/register')
        .send({ name: 'Other', email: 'dup@example.com', password: 'Passw0rd!' })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('validates input', async () => {
      const res = await ctx
        .http()
        .post('/api/auth/register')
        .send({ name: 'J', email: 'not-an-email', password: 'short' })
        .expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects unknown properties', async () => {
      await ctx
        .http()
        .post('/api/auth/register')
        .send({ name: 'Jane', email: 'j@example.com', password: 'Passw0rd!', role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await registerAndLogin(ctx, { email: 'login@example.com', password: 'Passw0rd!' });
    });

    it('logs in with valid credentials', async () => {
      const res = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'LOGIN@example.com', password: 'Passw0rd!' })
        .expect(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.email).toBe('login@example.com');
    });

    it('rejects a wrong password', async () => {
      const res = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: 'WrongPass1' })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects an unknown email with the same error', async () => {
      const res = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'Passw0rd!' })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('protected routes', () => {
    it('rejects requests without a token', async () => {
      const res = await ctx.http().get('/api/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects a malformed token', async () => {
      const res = await ctx
        .http()
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns the current user with a valid token', async () => {
      const { token } = await registerAndLogin(ctx, { email: 'me@example.com' });
      const res = await ctx
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.email).toBe('me@example.com');
    });

    it('revokes the token on logout', async () => {
      const { token } = await registerAndLogin(ctx);
      await ctx
        .http()
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const res = await ctx
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(res.body.error.code).toBe('SESSION_REVOKED');
    });

    it('keeps the health endpoint public', async () => {
      await ctx.http().get('/api/health').expect(200);
    });
  });
});
