const TOKEN_KEY = 'crm.accessToken';
const EXPIRES_KEY = 'crm.expiresAt';

export const authStorage = {
  getToken(): string | null {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = localStorage.getItem(EXPIRES_KEY);
    if (!token) return null;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      this.clear();
      return null;
    }
    return token;
  },
  set(token: string, expiresAt: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRES_KEY, expiresAt);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  },
};
