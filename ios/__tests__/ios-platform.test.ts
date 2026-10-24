jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

import * as ImagePicker from 'expo-image-picker';

import { pickPhotoFromLibrary } from '@/lib/photoLocation';

// Node built-ins, typed locally: the app's tsconfig loads only Jest types.
const fs: {
  readdirSync(dir: string, opts: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(file: string, encoding: 'utf8'): string;
} = require('fs');
const path: { join(...parts: string[]): string } = require('path');

const appJson = require('../app.json').expo;
const easJson = require('../eas.json');

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = appJson.plugins.find((p: unknown) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe('iOS photo library picks', () => {
  it('asks iOS for a JPEG-compatible file so HEIC photos pass the upload type check', async () => {
    await pickPhotoFromLibrary();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], exif: true, preferredAssetRepresentationMode: 'compatible' }),
    );
  });
});

describe('app.json', () => {
  it('is an iOS-only project with its own identity', () => {
    expect(appJson.platforms).toEqual(['ios']);
    expect(appJson.slug).toBe('growwmatics-ios');
    expect(appJson.ios.bundleIdentifier).toBe('com.growwmatics.app');
    expect(appJson.android).toBeUndefined();
    expect(appJson.icon).toBe('./assets/images/icon.png');
    expect(appJson.ios.icon).toBeUndefined();
  });

  it('declares no purpose strings for capabilities the app never uses', () => {
    expect(pluginOptions('expo-secure-store')).toMatchObject({ faceIDPermission: false });
    expect(pluginOptions('expo-location')).toMatchObject({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
    });
    expect(pluginOptions('expo-location')?.locationWhenInUsePermission).toEqual(expect.stringContaining('photo'));
  });

  it('is not linked to the Android app’s EAS project or update channel', () => {
    expect(appJson.extra?.eas).toBeUndefined();
    expect(appJson.updates).toBeUndefined();
    expect(appJson.owner).toBeUndefined();
  });
});

describe('eas.json', () => {
  it('has iOS-only build and submit profiles against the shared production backend', () => {
    expect(JSON.stringify(easJson)).not.toContain('android');
    expect(easJson.build.production.env.EXPO_PUBLIC_API_URL).toBe('https://growwmatics.com');
    expect(easJson.submit.production.ios).toBeDefined();
  });
});

describe('App Store purchase rules (3.1.1(a): no external purchase calls to action)', () => {
  it('has no link to the web pricing or checkout pages anywhere in the app', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && /\/(pricing|checkout)\b/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });

  it('collects no payments: no StoreKit / in-app purchase or payment SDK is installed', () => {
    const pkg = require('../package.json');
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /iap|in-app-purchase|purchases|storekit|razorpay|stripe|payment/i.test(d))).toEqual([]);
  });
});
