import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtPayload } from '../common/interfaces/authenticated-user.interface';

export interface IssuedToken {
  accessToken: string;
  expiresAt: Date;
}

/** Issues and verifies JWT access tokens. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(user: Pick<User, 'id' | 'email' | 'role'>): Promise<IssuedToken> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role, jti: randomUUID() };
    const accessToken = await this.jwt.signAsync(payload);
    const decoded = this.jwt.decode<JwtPayload>(accessToken);
    return { accessToken, expiresAt: new Date((decoded.exp ?? 0) * 1000) };
  }

  verify(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token);
  }
}
