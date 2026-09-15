/**
 * The raffle entry, and the card that used to point at the reader's own laptop.
 *
 * `RAFFLE_DEMO_APP` was unconditional: with `VITE_RAFFLE_URL` unset it fell
 * back to `http://localhost:5177`, the port `examples/raffle-demo` pins. In a
 * development build that is exactly right. In a DEPLOYED one it put a featured
 * card at the top of the Apps grid on a stranger's phone whose only
 * destination was a port on their own machine — a tap opened the in-app
 * browser on a connection that cannot be made, and nothing on the card could
 * have told them why. The deploy workflow does set the variable, so this never
 * reached a release; the entry existing anyway is the defect, because the
 * fallback's correctness depended on a variable being set somewhere else.
 *
 * `raffleDemoApp` takes its environment explicitly, so both answers are
 * drilled here rather than inferred from whichever environment the unit suite
 * happens to run in.
 */

import { describe, expect, it } from 'vitest';

import { raffleDemoApp, RAFFLE_DEMO_APP_ID, withLocalApps, type RegistryApp } from './registry.js';

/** One fetched registry entry, to prove the local ones are prepended to it. */
const FETCHED: RegistryApp = {
  id: '1am-explorer',
  name: '1AM Explorer',
  url: 'https://explorer.1am.xyz',
};

describe('the raffle entry', () => {
  it('is absent from a production build that names no raffle', () => {
    expect(raffleDemoApp({})).toBeNull();
    expect(raffleDemoApp({ DEV: false })).toBeNull();
    // A name with nowhere to send anyone is still nowhere to send anyone.
    expect(raffleDemoApp({ VITE_RAFFLE_NAME: 'Grand Prix Draw' })).toBeNull();
  });

  it('falls back to the pinned local port under a development build only', () => {
    const entry = raffleDemoApp({ DEV: true });
    expect(entry?.url).toBe('http://localhost:5177');
    expect(entry?.id).toBe(RAFFLE_DEMO_APP_ID);
  });

  it('uses the configured origin, in either kind of build', () => {
    for (const DEV of [true, false]) {
      const entry = raffleDemoApp({ VITE_RAFFLE_URL: 'https://raffle.example', DEV });
      expect(entry?.url).toBe('https://raffle.example');
      expect(entry?.featured).toBe(true);
    }
  });

  it('takes the configured label, and defaults to Midnight Raffle', () => {
    expect(raffleDemoApp({ VITE_RAFFLE_URL: 'https://raffle.example' })?.name).toBe(
      'Midnight Raffle',
    );
    expect(
      raffleDemoApp({ VITE_RAFFLE_URL: 'https://raffle.example', VITE_RAFFLE_NAME: 'Race Draw' })
        ?.name,
    ).toBe('Race Draw');
    // An empty label is not a label.
    expect(
      raffleDemoApp({ VITE_RAFFLE_URL: 'https://raffle.example', VITE_RAFFLE_NAME: '' })?.name,
    ).toBe('Midnight Raffle');
  });

  it('refuses an origin that is not a web address, rather than listing it', () => {
    /* These urls reach the in-app browser and its "open in a new tab" button,
       so a `javascript:` entry would execute as script. Unlike the fetched
       registry this value comes from the build's own environment, but the rule
       is the same one and it is checked the same way. */
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'not a url', '']) {
      expect(raffleDemoApp({ VITE_RAFFLE_URL: url })).toBeNull();
    }
    // …and plain http IS allowed, because a local raffle is served that way.
    expect(raffleDemoApp({ VITE_RAFFLE_URL: 'http://192.168.1.4:5177' })?.url).toBe(
      'http://192.168.1.4:5177',
    );
  });
});

describe('the grid a build assembles', () => {
  it('returns the fetched list untouched when this build configures neither local entry', () => {
    /* The unit suite runs with `DEV` set and no `VITE_RAFFLE_URL`, so the
       module-level entries follow from that; what matters here is that
       whatever they are, a fetched entry survives and is not duplicated. */
    const grid = withLocalApps([FETCHED]);
    expect(grid.filter((app) => app.id === FETCHED.id)).toHaveLength(1);
    expect(grid.at(-1)).toEqual(FETCHED);
    // Nothing null-shaped reaches the grid, whichever entries this build has.
    for (const app of grid) expect(app).not.toBeNull();
    expect(grid.every((app) => typeof app.id === 'string' && app.id.length > 0)).toBe(true);
  });

  it('never lists one id twice, so a registry copy of a local entry is dropped', () => {
    const grid = withLocalApps([
      { id: RAFFLE_DEMO_APP_ID, name: 'Someone else’s raffle', url: 'https://elsewhere.example' },
      FETCHED,
    ]);
    expect(grid.filter((app) => app.id === RAFFLE_DEMO_APP_ID).length).toBeLessThanOrEqual(1);
    expect(grid.some((app) => app.url === 'https://elsewhere.example')).toBe(false);
  });
});
