import { ImageUrlSigner, createImageUrlSigner } from './image-url-signer';

describe('ImageUrlSigner', () => {
  const secret = 'test-secret-key-32-chars-minimum-length';
  const baseUrl = 'https://worker.dev';

  let signer: ImageUrlSigner;

  beforeEach(() => {
    signer = createImageUrlSigner({ baseUrl, secret, defaultExpirySeconds: 300 });
  });

  describe('sign', () => {
    it('generates a valid signed URL with correct format', () => {
      const key = 'users/user-1/photos/file-1/original';
      const size = 'original' as const;
      const url = signer.sign(key, size, 300);

      expect(url).toContain(baseUrl + '/image?');
      expect(url).toContain('key=users%2Fuser-1%2Fphotos%2Ffile-1%2Foriginal');
      expect(url).toContain('size=original');
      expect(url).toContain('exp=');
      expect(url).toContain('sig=');
    });

    it('generates different signatures for different sizes', () => {
      const key = 'users/user-1/photos/file-1/original';
      const originalUrl = signer.sign(key, 'original', 300);
      const mediumUrl = signer.sign(key, 'medium', 300);
      const previewUrl = signer.sign(key, 'preview', 300);

      expect(originalUrl).not.toBe(mediumUrl);
      expect(originalUrl).not.toBe(previewUrl);
      expect(mediumUrl).not.toBe(previewUrl);
    });

    it('generates different signatures for different expiry times', () => {
      const key = 'users/user-1/photos/file-1/original';
      const url1 = signer.sign(key, 'original', 300);
      const url2 = signer.sign(key, 'original', 600);

      expect(url1).not.toBe(url2);
    });

    it('generates different signatures for different keys', () => {
      const url1 = signer.sign('users/user-1/photos/file-1/original', 'original', 300);
      const url2 = signer.sign('users/user-2/photos/file-2/original', 'original', 300);

      expect(url1).not.toBe(url2);
    });

    it('uses default expiry when not provided', () => {
      const key = 'users/user-1/photos/file-1/original';
      const url = signer.sign(key, 'original');
      expect(url).toContain('exp=');
    });
  });

  describe('signAll', () => {
    it('returns all four URL types', () => {
      const originalKey = 'users/user-1/photos/file-1/original';
      const urls = signer.signAll(originalKey, {
        mediumKey: 'users/user-1/photos/file-1/medium',
        previewKey: 'users/user-1/photos/file-1/preview',
        thumbnailKey: 'users/user-1/photos/file-1/thumbnail',
        expiresInSeconds: 300,
      });

      expect(urls.originalUrl).toContain('size=original');
      expect(urls.mediumUrl).toContain('size=medium');
      expect(urls.previewUrl).toContain('size=preview');
      expect(urls.thumbnailUrl).toContain('size=thumbnail');
    });

    it('returns null for missing variant keys', () => {
      const originalKey = 'users/user-1/photos/file-1/original';
      const urls = signer.signAll(originalKey, {
        mediumKey: null,
        previewKey: null,
        expiresInSeconds: 300,
      });

      expect(urls.originalUrl).toContain('size=original');
      expect(urls.mediumUrl).toBeNull();
      expect(urls.previewUrl).toBeNull();
      expect(urls.thumbnailUrl).toBeNull();
    });
  });

  describe('security: signature verification simulation', () => {
    it('signature changes when key is tampered', () => {
      const originalUrl = signer.sign('users/user-1/photos/file-1/original', 'original', 300);
      const tamperedUrl = signer.sign('users/user-1/photos/file-2/original', 'original', 300);

      expect(originalUrl).not.toBe(tamperedUrl);
    });

    it('signature changes when size is tampered', () => {
      const originalUrl = signer.sign('users/user-1/photos/file-1/original', 'original', 300);
      const tamperedUrl = signer.sign('users/user-1/photos/file-1/original', 'medium', 300);

      expect(originalUrl).not.toBe(tamperedUrl);
    });

    it('signature changes when expiry is tampered', () => {
      const originalUrl = signer.sign('users/user-1/photos/file-1/original', 'original', 300);
      const tamperedUrl = signer.sign('users/user-1/photos/file-1/original', 'original', 600);

      expect(originalUrl).not.toBe(tamperedUrl);
    });

    it('signature changes when secret is different', () => {
      const signer1 = createImageUrlSigner({
        baseUrl,
        secret: 'secret-1-32-chars-minimum-length',
        defaultExpirySeconds: 300,
      });
      const signer2 = createImageUrlSigner({
        baseUrl,
        secret: 'secret-2-32-chars-minimum-length',
        defaultExpirySeconds: 300,
      });

      const url1 = signer1.sign('users/user-1/photos/file-1/original', 'original', 300);
      const url2 = signer2.sign('users/user-1/photos/file-1/original', 'original', 300);

      expect(url1).not.toBe(url2);
    });
  });
});
