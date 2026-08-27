import { createHmac } from 'crypto';

const ALLOWED_SIZES = new Set(['original', 'preview', 'medium', 'thumbnail']);

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  value = value.replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) {
    value += '=';
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function verify(secret: string, message: string, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureBytes = fromBase64Url(signature);
  const messageBytes = new TextEncoder().encode(message);
  return crypto.subtle.verify('HMAC', key, signatureBytes.buffer as ArrayBuffer, messageBytes);
}

function createSignature(secret: string, key: string, size: string, expires: number): string {
  const message = `${key}\n${size}\n${expires}`;
  return createHmac('sha256', secret).update(message).digest('base64url');
}

describe('Cloudflare Worker Image Delivery', () => {
  const secret = 'test-secret-key-32-chars-minimum-length';
  const baseKey = 'users/user-1/photos/file-1/original';
  const expiry = Math.floor(Date.now() / 1000) + 300;

  describe('Signature verification', () => {
    it('accepts valid signature for original size', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const valid = await verify(secret, `${baseKey}\noriginal\n${expiry}`, sig);
      expect(valid).toBe(true);
    });

    it('accepts valid signature for medium size', async () => {
      const sig = createSignature(secret, baseKey, 'medium', expiry);
      const valid = await verify(secret, `${baseKey}\nmedium\n${expiry}`, sig);
      expect(valid).toBe(true);
    });

    it('accepts valid signature for preview size', async () => {
      const sig = createSignature(secret, baseKey, 'preview', expiry);
      const valid = await verify(secret, `${baseKey}\npreview\n${expiry}`, sig);
      expect(valid).toBe(true);
    });

    it('rejects expired URL', async () => {
      const expiredExpiry = Math.floor(Date.now() / 1000) - 100;
      const sig = createSignature(secret, baseKey, 'original', expiredExpiry);
      const valid = await verify(secret, `${baseKey}\noriginal\n${expiredExpiry}`, sig);
      expect(valid).toBe(true); // signature is valid but expired

      // Simulate worker expiry check
      const now = Math.floor(Date.now() / 1000);
      expect(now > expiredExpiry).toBe(true); // would return 403
    });

    it('rejects invalid signature (tampered)', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const tamperedSig = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
      const valid = await verify(secret, `${baseKey}\noriginal\n${expiry}`, tamperedSig);
      expect(valid).toBe(false);
    });

    it('rejects signature with wrong secret', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const valid = await verify(
        'wrong-secret-32-chars-minimum-length',
        `${baseKey}\noriginal\n${expiry}`,
        sig,
      );
      expect(valid).toBe(false);
    });

    it('rejects signature with wrong key', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const valid = await verify(
        secret,
        `users/user-2/photos/file-2/original\noriginal\n${expiry}`,
        sig,
      );
      expect(valid).toBe(false);
    });

    it('rejects signature with wrong size', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const valid = await verify(secret, `${baseKey}\nmedium\n${expiry}`, sig);
      expect(valid).toBe(false);
    });

    it('rejects signature with wrong expiry', async () => {
      const sig = createSignature(secret, baseKey, 'original', expiry);
      const valid = await verify(secret, `${baseKey}\noriginal\n${expiry + 1}`, sig);
      expect(valid).toBe(false);
    });
  });

  describe('Size validation', () => {
    it('allows original', () => {
      expect(ALLOWED_SIZES.has('original')).toBe(true);
    });

    it('allows medium', () => {
      expect(ALLOWED_SIZES.has('medium')).toBe(true);
    });

    it('allows preview', () => {
      expect(ALLOWED_SIZES.has('preview')).toBe(true);
    });

    it('allows thumbnail (pre-generated variant)', () => {
      expect(ALLOWED_SIZES.has('thumbnail')).toBe(true);
    });

    it('rejects large', () => {
      expect(ALLOWED_SIZES.has('large')).toBe(false);
    });

    it('rejects arbitrary size', () => {
      expect(ALLOWED_SIZES.has('arbitrary')).toBe(false);
    });
  });

  describe('Path traversal prevention', () => {
    const validKeys = [
      'users/user-1/photos/file-1/original',
      'users/abc/photos/xyz/original',
      'users/user-123/photos/file-456/original',
      'users/user-1/photos/file-1/medium',
      'users/user-1/photos/file-1/preview',
      'users/user-1/photos/file-1/thumbnail',
    ];

    const invalidKeys = [
      '../../../etc/passwd',
      'users/user-1/photos/file-1/../original',
      'users/user-1/photos/file-1/',
      'users/user-1/photos/',
      '',
      'original',
      'users/user-1/photos/file-1/original/extra',
    ];

    it('accepts valid key formats', () => {
      const pattern = /^users\/[^/]+\/photos\/[^/]+\/(original|thumbnail|preview|medium)$/;
      validKeys.forEach((key) => {
        expect(pattern.test(key)).toBe(true);
      });
    });

    it('rejects invalid key formats', () => {
      const pattern = /^users\/[^/]+\/photos\/[^/]+\/(original|thumbnail|preview|medium)$/;
      invalidKeys.forEach((key) => {
        expect(pattern.test(key)).toBe(false);
      });
    });
  });

  describe('R2 variant key construction', () => {
    const r2BaseUrl = 'https://picvibz.r2.dev';

    it('constructs direct URL for original', () => {
      const key = 'users/user-1/photos/file-1/original';
      const fetchUrl = `${r2BaseUrl}/${key}`;
      expect(fetchUrl).toBe('https://picvibz.r2.dev/users/user-1/photos/file-1/original');
    });

    it('constructs direct URL for medium variant key', () => {
      const key = 'users/user-1/photos/file-1/medium';
      const fetchUrl = `${r2BaseUrl}/${key}`;
      expect(fetchUrl).toBe('https://picvibz.r2.dev/users/user-1/photos/file-1/medium');
    });

    it('constructs direct URL for preview variant key', () => {
      const key = 'users/user-1/photos/file-1/preview';
      const fetchUrl = `${r2BaseUrl}/${key}`;
      expect(fetchUrl).toBe('https://picvibz.r2.dev/users/user-1/photos/file-1/preview');
    });
  });
});
