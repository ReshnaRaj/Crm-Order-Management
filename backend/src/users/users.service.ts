import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/utils/app.exception';
import { ChangePasswordDto, UpdateProfileDto, UserResponseDto } from './dto/user.dto';
import { PasswordService } from './password.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
  ) {}

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppException('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
    return UserResponseDto.from(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponseDto> {
    const user = await this.users.update(userId, { name: dto.name });
    return UserResponseDto.from(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new AppException('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
    const ok = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!ok) {
      throw new AppException(
        'INVALID_PASSWORD',
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.users.update(userId, { passwordHash: await this.passwords.hash(dto.newPassword) });
  }
}
