/**
 * The grid a build assembles, and the raffle that is no longer in it.
 *
 * Until 2026/09/25 Passport prepended a featured "Midnight Raffle" entry of its
 * own to the fetched registry — in every development build, and in every
 * deployed build that set `VITE_RAFFLE_URL`, which the release pipeline did. So
 * staging and production showed it at the top of Home and of Apps although the
 * registry has no such entry. It was taken out of the Passport UI; the only
 * entry a build may still add is the developer's own `VITE_LOCAL_APP_URL`,
 * which the unit suite does not set.
 */

import { describe, expect, it } from 'vitest';

import { LOCAL_DEV_APP, withLocalApps, type RegistryApp } from './registry.js';

/** One fetched registry entry. */
const FETCHED: RegistryApp = {
  id: '1am-explorer',
  name: '1AM Explorer',
  url: 'https://explorer.1am.xyz',
};

describe('the grid a build assembles', () => {
  it('adds nothing of its own when the build configures no local app', () => {
    expect(LOCAL_DEV_APP).toBeNull();
    expect(withLocalApps([FETCHED])).toEqual([FETCHED]);
    expect(withLocalApps([])).toEqual([]);
  });

  it('never adds the Midnight Raffle, whatever the build environment', () => {
    /* The unit suite runs with Vite's `DEV` set — the one condition under which
       the raffle used to appear with no variable set at all. */
    const grid = withLocalApps([FETCHED]);
    expect(grid.some((app) => app.id === 'raffle-demo')).toBe(false);
    expect(grid.some((app) => /raffle/i.test(app.name))).toBe(false);
  });

  it('passes a fetched entry through as the registry published it, never featured by us', () => {
    const published: RegistryApp = {
      id: 'raffle-demo',
      name: 'A registry app',
      url: 'https://elsewhere.example',
    };
    const grid = withLocalApps([published, FETCHED]);
    expect(grid).toEqual([published, FETCHED]);
    expect(grid[0]?.featured).toBeUndefined();
  });
});
