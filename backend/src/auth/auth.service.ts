import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AppException } from '../common/utils/app.exception';
import { isUniqueViolation } from '../prisma/prisma.service';
import { UserResponseDto } from '../users/dto/user.dto';
import { PasswordService } from '../users/password.service';
import { UsersRepository } from '../users/users.repository';
import { AuthRepository } from './auth.repository';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly authRepo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (await this.users.findByEmail(dto.email)) {
      throw this.emailTaken();
    }
    // The very first account becomes the workspace administrator.
    const role = (await this.users.count()) === 0 ? UserRole.ADMIN : UserRole.USER;
    try {
      const user = await this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await this.passwords.hash(dto.password),
        role,
      });
      this.logger.log({ event: 'user.registered', userId: user.id });
      const token = await this.tokens.issue(user);
      return {
        accessToken: token.accessToken,
        expiresAt: token.expiresAt.toISOString(),
        user: UserResponseDto.from(user),
      };
    } catch (e) {
      if (isUniqueViolation(e)) throw this.emailTaken(); // concurrent registration race
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findByEmail(dto.email);
    // Same error for unknown email and wrong password to avoid user enumeration.
    const valid = user ? await this.passwords.verify(user.passwordHash, dto.password) : false;
    if (!user || !valid) {
      this.logger.warn({ event: 'auth.login_failed' });
      throw new AppException(
        'INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = await this.tokens.issue(user);
    return {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt.toISOString(),
      user: UserResponseDto.from(user),
    };
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.authRepo.revokeToken(user.jti, user.tokenExpiresAt);
  }

  async me(user: AuthenticatedUser): Promise<UserResponseDto> {
    const found = await this.users.findById(user.id);
    if (!found) throw new AppException('UNAUTHORIZED', 'Session is no longer valid', HttpStatus.UNAUTHORIZED);
    return UserResponseDto.from(found);
  }

  /** Validates a bearer token and resolves the authenticated user (used by the global guard). */
  async authenticate(token: string): Promise<AuthenticatedUser> {
    let payload;
    try {
      payload = await this.tokens.verify(token);
    } catch (e) {
      const expired = e instanceof Error && e.name === 'TokenExpiredError';
      throw new AppException(
        expired ? 'SESSION_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'Your session has expired, please log in again' : 'Invalid authentication token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!payload.jti || (await this.authRepo.isTokenRevoked(payload.jti))) {
      throw new AppException('SESSION_REVOKED', 'Session has been logged out', HttpStatus.UNAUTHORIZED);
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new AppException('INVALID_TOKEN', 'Invalid authentication token', HttpStatus.UNAUTHORIZED);
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      jti: payload.jti,
      tokenExpiresAt: new Date((payload.exp ?? 0) * 1000),
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeRevokedTokens() {
    const n = await this.authRepo.purgeExpired();
    if (n) this.logger.log({ event: 'auth.revoked_tokens_purged', count: n });
  }

  private emailTaken() {
    return new AppException(
      'EMAIL_TAKEN',
      'An account with this email already exists',
      HttpStatus.CONFLICT,
    );
  }
}
