import { describe, expect, it } from 'vitest';

import { describePushError, resolveVapidSubject } from './web-push.js';

describe('resolveVapidSubject', () => {
  it('prefers the .env value, then the process env', () => {
    expect(resolveVapidSubject('mailto:me@example.com', 'https://env.example', undefined)).toBe('mailto:me@example.com');
    expect(resolveVapidSubject(undefined, 'https://env.example', undefined)).toBe('https://env.example');
  });

  it('ignores the old .local default that earlier versions persisted (Apple rejects it)', () => {
    expect(resolveVapidSubject('mailto:operator@shinobi.local', undefined, undefined)).toBe('https://github.com/numbererikson/shinobi');
    expect(resolveVapidSubject('mailto:operator@shinobi.local', 'mailto:me@example.com', undefined)).toBe('mailto:me@example.com');
  });

  it('falls back to the public https URL, then the project URL', () => {
    expect(resolveVapidSubject(undefined, undefined, 'https://shinobi.example.com/')).toBe('https://shinobi.example.com');
    expect(resolveVapidSubject(undefined, undefined, 'http://localhost:8765')).toBe('https://github.com/numbererikson/shinobi');
    expect(resolveVapidSubject('  ', undefined, undefined)).toBe('https://github.com/numbererikson/shinobi');
  });
});

describe('describePushError', () => {
  it('shows the status and the push service reason', () => {
    const err = Object.assign(new Error('Received unexpected response code'), { statusCode: 403, body: '{"reason":"BadJwtToken"}' });
    expect(describePushError(err)).toBe('403 BadJwtToken');
  });

  it('keeps a non-JSON body or the message', () => {
    expect(describePushError(Object.assign(new Error('x'), { statusCode: 400, body: 'bad request' }))).toBe('400 bad request');
    expect(describePushError(Object.assign(new Error('Received unexpected response code'), { statusCode: 500, body: '' }))).toBe(
      '500 Received unexpected response code',
    );
    expect(describePushError(new Error('getaddrinfo ENOTFOUND'))).toBe('getaddrinfo ENOTFOUND');
  });
});
