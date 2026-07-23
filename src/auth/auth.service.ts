import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as bcryptjs from 'bcryptjs';
import { randomBytes } from 'crypto';
import * as nodemailer from 'nodemailer';

@Injectable()
export class AuthService {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    const smtpKey = this.config.get<string>('BREVO_SMTP_KEY');
    if (smtpKey) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: { user: smtpKey, pass: smtpKey },
      });
    }
  }

  private issueToken(user: { id: string; email: string }) {
    return this.jwt.signAsync({ sub: user.id, email: user.email });
  }

  private excludePassword(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcryptjs.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        provider: 'email',
      },
    });

    const token = await this.issueToken(user);
    return { user: this.excludePassword(user), token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcryptjs.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = await this.issueToken(user);
    return { user: this.excludePassword(user), token };
  }

  async googleLogin(dto: GoogleLoginDto) {
    let userInfo: { email?: string; name?: string; picture?: string; sub?: string };
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${dto.accessToken}` },
      });
      if (!res.ok) throw new Error();
      userInfo = await res.json();
    } catch {
      throw new UnauthorizedException('Invalid Google access token');
    }

    const email = userInfo.email;
    if (!email) {
      throw new BadRequestException('Google account has no email');
    }

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.provider !== 'google') {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            provider: 'google',
            providerId: userInfo.sub,
            photoURL: userInfo.picture || user.photoURL,
            displayName: userInfo.name || user.displayName,
          },
        });
      }
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          displayName: userInfo.name || email.split('@')[0],
          photoURL: userInfo.picture || null,
          provider: 'google',
          providerId: userInfo.sub,
        },
      });
    }

    const token = await this.issueToken(user);
    return { user: this.excludePassword(user), token };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return this.excludePassword(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { email: dto.email, token, expiresAt },
    });

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: 'noreply@picvibz.com',
          to: dto.email,
          subject: 'PicVibz Password Reset',
          html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 1 hour.</p>`,
        });
      } catch (err) {
        console.error('Failed to send email:', err);
      }
    } else {
      console.log('Password reset link:', resetLink);
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
    });

    if (!record || record.used || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcryptjs.hash(dto.newPassword, 12);

    await this.prisma.user.update({
      where: { email: record.email },
      data: { passwordHash, provider: 'email' },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    });

    return { message: 'Password reset successful' };
  }
}
