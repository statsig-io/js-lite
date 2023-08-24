/**
 * @jest-environment jsdom
 */

import StatsigClient from '../StatsigClient';
import LocalStorageMock from './LocalStorageMock';

import { getHashValue } from '../utils/Hashing';

describe('Verify behavior of StatsigClient', () => {
  const sdkKey = 'client-clienttestkey';
  const baseInitResponse = {
    feature_gates: {
      [getHashValue('test_gate')]: {
        value: true,
        rule_id: 'ruleID123',
      },
    },
    dynamic_configs: {
      [getHashValue('test_config')]: {
        value: {
          num: 4,
        },
      },
    },
    has_updates: true,
    time: 123456789,
  };

  let respObject: any = baseInitResponse;

  var parsedRequestBody: {
    events: Record<string, any>[];
    statsigMetadata: Record<string, any>;
  } | null;
  // @ts-ignore
  global.fetch = jest.fn((url, params) => {
    if (!url.toString().includes('download_config_specs')) {
      return Promise.reject(new Error('invalid initialize endpoint'));
    }

    parsedRequestBody = JSON.parse(params?.body as string);
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(respObject)),
    });
  });

  const localStorage = new LocalStorageMock();
  // @ts-ignore
  Object.defineProperty(window, 'localStorage', {
    value: localStorage,
  });

  beforeEach(() => {
    let respObject = baseInitResponse;
    jest.resetModules();
    parsedRequestBody = null;

    window.localStorage.clear();
  });

  test('Test constructor will populate from cache on create', () => {
    expect.assertions(4);
    const client = new StatsigClient(sdkKey);
    expect(() => {
      client.checkGate('gate');
    }).not.toThrow();
    expect(() => {
      client.getConfig('config');
    }).not.toThrow();
    expect(() => {
      client.getExperiment('experiment');
    }).not.toThrow();
    expect(() => {
      client.logEvent('event');
    }).not.toThrow();
  });

  test('that overriding api overrides both api and logevent api', async () => {
    expect.assertions(2);
    const statsig = new StatsigClient(
      sdkKey,
      { userID: '123' },
      {
        api: 'https://statsig.jkw.com/v1',
      },
    );

    await statsig.initializeAsync();

    expect(statsig._options.api).toEqual('https://statsig.jkw.com/v1/');
    expect(statsig._options.eventLoggingApi).toEqual(
      'https://statsig.jkw.com/v1/',
    );
  });

  test('that overrideStableID works for local storage and gets set correctly in request', async () => {
    expect.assertions(7);

    const statsig = new StatsigClient(sdkKey);
    await statsig.initializeAsync();
    let stableID = parsedRequestBody!['statsigMetadata']['stableID'];
    expect(stableID).toBeTruthy();
    expect(statsig.getStableID()).toEqual(stableID);

    const statsig2 = new StatsigClient(sdkKey, null, {
      overrideStableID: '123',
    });
    await statsig2.initializeAsync();
    expect(parsedRequestBody!['statsigMetadata']['stableID']).not.toEqual(
      stableID,
    );
    expect(parsedRequestBody!['statsigMetadata']['stableID']).toEqual('123');
    expect(statsig2.getStableID()).toEqual('123');

    const statsig3 = new StatsigClient(sdkKey, null, {
      overrideStableID: '456',
    });
    await statsig3.initializeAsync();
    expect(parsedRequestBody!['statsigMetadata']['stableID']).toEqual('456');

    const statsig4 = new StatsigClient(sdkKey, null);
    await statsig4.initializeAsync();
    expect(parsedRequestBody!['statsigMetadata']['stableID']).toEqual('456');
  });

  test('that localMode supports a dummy statsig', async () => {
    expect.assertions(3);
    parsedRequestBody = null;
    const statsig = new StatsigClient(
      sdkKey,
      {},
      {
        localMode: true,
      },
    );
    await statsig.initializeAsync();
    expect(parsedRequestBody).toBeNull(); // never issued the request

    expect(statsig.checkGate('test_gate')).toEqual(false);
    expect(statsig.getConfig('test_config').getValue()).toEqual({});
  });
});
