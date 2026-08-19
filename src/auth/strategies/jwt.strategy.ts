import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { createPublicKey } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { PrismaService } from '../../prisma/prisma.service';

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

interface Jwk {
  kid?: string;
  kty?: string;
  crv?: string;
  alg?: string;
  use?: string;
  x?: string;
  y?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private jwksCache: { fetchedAt: number; keys: Map<string, string> } | null = null;

  constructor(
    config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly prisma: PrismaService,
  ) {
    const supabaseUrl = config.getOrThrow<string>('SUPABASE_URL');
    const jwksUrl = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['ES256'],
      secretOrKeyProvider: (request, rawJwtToken, done) => {
        this.getPublicKey(jwksUrl, rawJwtToken)
          .then((key) => done(null, key))
          .catch((err) => done(err));
      },
    });
  }

  private async getPublicKey(jwksUrl: string, rawJwtToken: string) {
    const kid = this.extractKid(rawJwtToken);
    if (!kid) {
      throw new UnauthorizedException('Invalid token');
    }

    await this.refreshJwksIfStale(jwksUrl);

    const key = this.jwksCache?.keys.get(kid);
    if (!key) {
      throw new UnauthorizedException('Invalid token');
    }

    return key;
  }

  private extractKid(token: string): string | undefined {
    const header = token.split('.')[0];
    if (!header) return undefined;
    try {
      const decoded = Buffer.from(header, 'base64url').toString('utf8');
      return (JSON.parse(decoded) as { kid?: string }).kid;
    } catch {
      return undefined;
    }
  }

  private async refreshJwksIfStale(jwksUrl: string) {
    const now = Date.now();
    if (this.jwksCache && now - this.jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
      return;
    }

    const res = await fetch(jwksUrl);
    if (!res.ok) {
      throw new UnauthorizedException('Invalid token');
    }

    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, string>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kid && jwk.kty === 'EC' && jwk.x && jwk.y) {
        const publicKey = createPublicKey({
          key: { kty: 'EC', crv: jwk.crv ?? 'P-256', x: jwk.x, y: jwk.y },
          format: 'jwk',
        });
        const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
        keys.set(jwk.kid, pem);
      }
    }

    if (keys.size === 0) {
      throw new UnauthorizedException('Invalid token');
    }

    this.jwksCache = { fetchedAt: now, keys };
  }

  async validate(payload: { sub?: string; email?: string }) {
    const uid = payload.sub;
    if (!uid) {
      throw new UnauthorizedException('Invalid token');
    }

    let user = await this.prisma.user.findUnique({
      where: { supabaseUid: uid },
    });

    if (!user && payload.email) {
      user = await this.prisma.user.upsert({
        where: { email: payload.email },
        update: { supabaseUid: uid },
        create: {
          email: payload.email,
          supabaseUid: uid,
          displayName: payload.email.split('@')[0],
        },
      });
    }

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
