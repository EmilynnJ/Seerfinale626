/**
 * Unit tests for the CloudinaryService.
 *
 * Covers:
 *  - disabled behavior -> ensureConfigured throws an error
 *  - successful upload -> calls cloudinary.uploader.upload_stream and resolves correctly
 *  - failed upload -> upload_stream returns an error, promise rejects
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { v2 as cloudinary } from 'cloudinary';

vi.mock('cloudinary', () => {
  return {
    v2: {
      config: vi.fn(),
      uploader: {
        upload_stream: vi.fn(),
      },
    },
  };
});

async function loadServiceWithEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const mod = await import('../services/cloudinary-service');
  return mod.cloudinaryService;
}

describe('CloudinaryService', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is not enabled when config is missing', async () => {
    const svc = await loadServiceWithEnv({
      CLOUDINARY_CLOUD_NAME: '',
      CLOUDINARY_API_KEY: '',
      CLOUDINARY_API_SECRET: '',
    });

    expect(svc.enabled).toBe(false);

    await expect(svc.uploadBuffer(Buffer.from('test'))).rejects.toThrow(
      'Cloudinary is not configured',
    );
  });

  it('is enabled and uploads buffer successfully when configured', async () => {
    const svc = await loadServiceWithEnv({
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    });

    expect(svc.enabled).toBe(true);

    // Mock stream object with 'end' method
    const mockStream = { end: vi.fn() };

    // Setup upload_stream to immediately call its callback with success
    vi.mocked(cloudinary.uploader.upload_stream).mockImplementation((opts, callback) => {
      if (callback) {
        callback(undefined, { secure_url: 'https://test-url.com/img.jpg', public_id: 'test-public-id' } as any);
      }
      return mockStream as any;
    });

    const buffer = Buffer.from('test-image-data');
    const result = await svc.uploadBuffer(buffer, { folder: 'test/folder', publicId: 'custom-id' });

    expect(result).toEqual({ url: 'https://test-url.com/img.jpg', publicId: 'test-public-id' });
    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'test-cloud',
      api_key: 'test-key',
      api_secret: 'test-secret',
      secure: true,
    });
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledTimes(1);
    expect(mockStream.end).toHaveBeenCalledWith(buffer);

    const [optsArg] = vi.mocked(cloudinary.uploader.upload_stream).mock.calls[0];
    expect(optsArg).toMatchObject({
      folder: 'test/folder',
      public_id: 'custom-id',
      resource_type: 'image',
    });
  });

  it('rejects when Cloudinary upload fails', async () => {
    const svc = await loadServiceWithEnv({
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    });

    const mockStream = { end: vi.fn() };

    vi.mocked(cloudinary.uploader.upload_stream).mockImplementation((opts, callback) => {
      if (callback) {
        callback(new Error('Upload failed'), undefined);
      }
      return mockStream as any;
    });

    await expect(svc.uploadBuffer(Buffer.from('test'))).rejects.toThrow('Upload failed');
  });

  it('rejects when Cloudinary returns no result', async () => {
    const svc = await loadServiceWithEnv({
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    });

    const mockStream = { end: vi.fn() };

    vi.mocked(cloudinary.uploader.upload_stream).mockImplementation((opts, callback) => {
      if (callback) {
        callback(undefined, undefined);
      }
      return mockStream as any;
    });

    await expect(svc.uploadBuffer(Buffer.from('test'))).rejects.toThrow('Cloudinary returned no result');
  });
});
