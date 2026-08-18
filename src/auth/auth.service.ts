import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  private async findOrCreateUser(supabaseUser: { id: string; email?: string; user_metadata?: { full_name?: string; avatar_url?: string; name?: string } }) {
    const email = supabaseUser.email ?? '';
    let user = await this.prisma.user.findUnique({ where: { supabaseUid: supabaseUser.id } });

    if (!user) {
      user = await this.prisma.user.upsert({
        where: { email },
        update: { supabaseUid: supabaseUser.id },
        create: {
          email,
          supabaseUid: supabaseUser.id,
          displayName:
            supabaseUser.user_metadata?.full_name ??
            supabaseUser.user_metadata?.name ??
            email.split('@')[0],
          photoURL: supabaseUser.user_metadata?.avatar_url ?? null,
        },
      });
    }

    return user;
  }

  async signup(dto: SignupDto) {
    const { data, error } = await this.supabase.client.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: { data: { display_name: dto.displayName } },
    });

    if (error) {
      if (error.message.includes('already registered')) {
        throw new ConflictException('Email already registered');
      }
      throw new BadRequestException(error.message);
    }

    const supabaseUser = data.user;
    if (!supabaseUser) throw new BadRequestException('Signup failed');

    const user = await this.findOrCreateUser(supabaseUser);

    return {
      user,
      session: data.session,
    };
  }

  async login(dto: LoginDto) {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const supabaseUser = data.user;
    if (!supabaseUser) throw new UnauthorizedException('Invalid email or password');

    const user = await this.findOrCreateUser(supabaseUser);

    return {
      user,
      session: data.session,
    };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const { data, error } = await this.supabase.client.auth.signInWithIdToken({
      provider: 'google',
      token: dto.accessToken,
    });

    if (error) {
      throw new UnauthorizedException('Invalid Google access token');
    }

    const supabaseUser = data.user;
    if (!supabaseUser) throw new UnauthorizedException('Invalid Google access token');

    const user = await this.findOrCreateUser(supabaseUser);

    return {
      user,
      session: data.session,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const redirectUrl = this.config.get<string>(
      'FRONTEND_URL',
      'http://localhost:3001',
    );

    const { error } = await this.supabase.client.auth.resetPasswordForEmail(
      dto.email,
      { redirectTo: `${redirectUrl}/reset-password` },
    );

    if (error) {
      console.error('Failed to send reset email:', error.message);
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { error } = await this.supabase.client.auth.updateUser({
      password: dto.newPassword,
    });

    if (error) {
      throw new BadRequestException(error.message);
    }

    return { message: 'Password reset successful' };
  }
}