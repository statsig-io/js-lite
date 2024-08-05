/**
 * @jest-environment jsdom
 */

import Statsig from '../index';
import { StatsigInitializeResponse } from './index.test';

describe('Log Event Fallback', () => {
  const response: StatsigInitializeResponse = {
    feature_gates: {},
    dynamic_configs: {},
    layer_configs: {},
    sdkParams: {},
    has_updates: true,
    time: 16,
  };
  const fallbackHost = 'https://fallback';
  const defaultHost = 'https://default';

  let events: Record<string, unknown>[] = [];

  beforeAll(async () => {
    // @ts-ignore
    global.fetch = jest.fn((url, params) => {
      if (url.toString().includes('rgstr')) {
        if (url.toString().startsWith(defaultHost)) {
          return Promise.resolve({
            ok: false,
            status: 500,
          });
        }
        if (url.toString().startsWith(fallbackHost)) {
          events = JSON.parse(params?.body as string).events;
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve('{}'),
          });
        }
      }

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(response)),
      });
    });

    Statsig.initialize(
      'client-key',
      { userID: 'a' },
      { api: defaultHost, eventLoggingApiForRetries: fallbackHost },
    );
    Statsig.logEvent('custom_event');
    Statsig.shutdown();
  });

  test('Fails the first request', () => {
    expect(events.length).toBe(0);
  });

  test('Succeeds the second request', async () => {
    await new Promise((r) => setTimeout(r, 1000));
    expect(events.length).toBe(1);
  });
});
