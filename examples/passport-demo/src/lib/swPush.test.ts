/**
 * The `push` payload parser in `public/sw.js`, tested as the worker ships it:
 * the function's source is lifted out of the file and evaluated, so what is
 * drilled here is the reviewed code and not a copy of it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

const worker = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8');

function lift(): (text: string) => { title: string; body: string; tag: string; url: string } {
  const constants = ['PUSH_DEFAULT_TITLE', 'PUSH_DEFAULT_BODY'].map((name) => {
    const match = new RegExp(`const ${name} = '[^']*';`).exec(worker);
    if (!match) throw new Error(`${name} is missing from sw.js`);
    return match[0];
  });
  const start = worker.indexOf('function pushNotificationFrom(text) {');
  const end = worker.indexOf("\nself.addEventListener('push'", start);
  if (start < 0 || end < 0) throw new Error('pushNotificationFrom is missing from sw.js');
  const source = `(() => {\n${constants.join('\n')}\n${worker.slice(start, end)}\nreturn pushNotificationFrom;\n})()`;
  return runInNewContext(source) as ReturnType<typeof lift>;
}

const pushNotificationFrom = lift();
const TX = 'ef'.repeat(32);

describe('sw.js push payload', () => {
  it('reads the data FCM wraps', () => {
    const text = JSON.stringify({
      data: { title: 'You received a payment', body: 'Open Passport to see it.', txHash: TX, url: '/' },
      from: '555154905726',
      fcmMessageId: 'x',
    });
    expect(pushNotificationFrom(text)).toEqual({
      title: 'You received a payment',
      body: 'Open Passport to see it.',
      tag: `passport-payment-${TX}`,
      url: '/',
    });
  });

  it('reads a flat payload too', () => {
    expect(pushNotificationFrom(JSON.stringify({ title: 'T', body: 'B', txHash: TX })).title).toBe('T');
  });

  it('falls back to the fixed sentence for anything unreadable', () => {
    for (const text of ['', 'not json', 'null', '42', JSON.stringify({ data: { title: '  ' } })]) {
      expect(pushNotificationFrom(text)).toEqual({
        title: 'You received a payment',
        body: 'Open Passport to see it.',
        tag: 'passport-payment',
        url: '/',
      });
    }
  });

  it('never takes a url from the message, and bounds the text', () => {
    const shown = pushNotificationFrom(
      JSON.stringify({ data: { url: 'https://evil.example', body: 'x'.repeat(500), txHash: 'nothex' } }),
    );
    expect(shown.url).toBe('/');
    expect(shown.body).toHaveLength(200);
    expect(shown.tag).toBe('passport-payment');
  });

  it('keeps the handlers the worker already had', () => {
    for (const event of ['install', 'activate', 'message', 'notificationclick', 'fetch', 'push', 'pushsubscriptionchange']) {
      expect(worker).toContain(`self.addEventListener('${event}'`);
    }
  });
});
