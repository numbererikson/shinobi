import { join, resolve } from 'node:path';
import { configDir } from '../../lib/config.js';
import type { Locale } from './types.js';

export interface CompanionConfig {
  enabled: boolean;
  name: string;
  locale: Locale;
  /** Directory holding one image per pose. */
  artDir: string;
}

const DEFAULT_NAME = 'Rin';

function envValue(key: string): string | undefined {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : undefined;
}

export function companionDir(): string {
  return join(configDir(), 'companion');
}

export function companionConfig(): CompanionConfig {
  const name = envValue('SHINOBI_COMPANION_NAME') ?? DEFAULT_NAME;
  const localeRaw = envValue('SHINOBI_COMPANION_LOCALE');
  const locale: Locale = localeRaw === 'hr' ? 'hr' : 'en';
  const artOverride = envValue('SHINOBI_COMPANION_ART_DIR');
  return {
    // Off unless explicitly turned on: an assistant that appears uninvited in
    // a shared screen is a surprise nobody asked for.
    enabled: envValue('SHINOBI_COMPANION') === 'on',
    name,
    locale,
    artDir: artOverride ? resolve(artOverride) : join(companionDir(), 'art'),
  };
}
