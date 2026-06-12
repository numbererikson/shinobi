import { describe, expect, it } from 'vitest';
import { filePathsMatch, normalizeFilePath, normalizeFilesTouched } from './paths.js';

describe('normalizeFilePath', () => {
  it('strips Windows laragon roots and converts backslashes', () => {
    expect(normalizeFilePath('c:\\laragon\\www\\shinobi-apps-site\\public\\blog\\index.php')).toBe(
      'public/blog/index.php',
    );
    expect(normalizeFilePath('C:\\Laragon\\www\\myrepo\\src\\app.ts')).toBe('src/app.ts');
  });

  it('strips Unix home checkouts', () => {
    expect(normalizeFilePath('/home/user/shinobi/src/cli.ts')).toBe('src/cli.ts');
    expect(normalizeFilePath('/Users/erik/shinobi/src/cli.ts')).toBe('src/cli.ts');
  });

  it('strips tilde and container roots', () => {
    expect(normalizeFilePath('~/shinobi/src/sync/push.ts')).toBe('src/sync/push.ts');
    expect(normalizeFilePath('/app/dist/cli.js')).toBe('dist/cli.js');
    expect(normalizeFilePath('/var/www/site/public/index.php')).toBe('public/index.php');
  });

  it('leaves repo-relative paths unchanged', () => {
    expect(normalizeFilePath('app/config/base_routes.php')).toBe('app/config/base_routes.php');
    expect(normalizeFilePath('src/lib/db.ts')).toBe('src/lib/db.ts');
  });

  it('passes through unrecognized absolute roots slash-normalized', () => {
    expect(normalizeFilePath('/opt/custom/place/file.ts')).toBe('/opt/custom/place/file.ts');
    expect(normalizeFilePath('x:\\weird\\file.ts')).toBe('x:/weird/file.ts');
  });
});

describe('normalizeFilesTouched', () => {
  it('normalizes, dedupes, and nulls empty input', () => {
    expect(
      normalizeFilesTouched([
        'c:\\laragon\\www\\repo\\src\\a.ts',
        '/home/user/repo/src/a.ts',
        'src/b.ts',
      ]),
    ).toEqual(['src/a.ts', 'src/b.ts']);
    expect(normalizeFilesTouched([])).toBeNull();
    expect(normalizeFilesTouched(null)).toBeNull();
    expect(normalizeFilesTouched(undefined)).toBeNull();
  });
});

describe('filePathsMatch', () => {
  it('matches the same file across device roots', () => {
    expect(
      filePathsMatch('c:\\laragon\\www\\site\\public\\blog\\index.php', 'public/blog/index.php'),
    ).toBe(true);
    expect(filePathsMatch('/home/user/shinobi/src/cli.ts', 'src/cli.ts')).toBe(true);
    expect(filePathsMatch('src/cli.ts', 'src/cli.ts')).toBe(true);
  });

  it('suffix-matches legacy rows with unknown absolute roots', () => {
    expect(filePathsMatch('/opt/custom/checkout/src/lib/db.ts', 'src/lib/db.ts')).toBe(true);
  });

  it('is case-insensitive for Windows-origin paths', () => {
    expect(filePathsMatch('App/Config/Routes.php', 'app/config/routes.php')).toBe(true);
  });

  it('rejects different files and bare-basename overreach', () => {
    expect(filePathsMatch('src/lib/db.ts', 'src/lib/fts.ts')).toBe(false);
    expect(filePathsMatch('src/other/db.ts', 'lib/db.ts')).toBe(false);
  });
});
