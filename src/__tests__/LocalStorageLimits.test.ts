/**
 * @jest-environment jsdom
 */

import StatsigClient from '../StatsigClient';
import { INTERNAL_STORE_KEY } from '../utils/Constants';
import { getUserCacheKey } from '../utils/Hashing';
import LocalStorageMock from './LocalStorageMock';

describe('Verify local storage limits are enforced', () => {
  const sdkKey = 'client-internalstorekey';
  const gates = {
    '3114454104': {
      value: true,
      rule_id: 'ruleID12',
      secondary_exposures: [
        {
          gate: 'dependent_gate_1',
          gateValue: 'true',
          ruleID: 'rule_1',
        },
      ],
    },
  };
  const configs = {
    '3591394191': {
      value: { bool: true },
      rule_id: 'default',
      secondary_exposures: [
        {
          gate: 'dependent_gate_1',
          gateValue: 'true',
          ruleID: 'rule_1',
        },
      ],
    },
  };

  const localStorage = new LocalStorageMock();
  // @ts-ignore
  Object.defineProperty(window, 'localStorage', {
    value: localStorage,
  });

  // @ts-ignore
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            feature_gates: {
              '3114454104': {
                value: true,
                rule_id: 'ruleID123',
              },
            },
            dynamic_configs: configs,
            time: 1646026677427,
            has_updates: true,
          }),
        ),
    }),
  );

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem(
      INTERNAL_STORE_KEY,
      JSON.stringify({
        first: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677415,
        },
        second: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677418,
        },
        third: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677410,
        },
        fourth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677419,
        },
        fifth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677422,
        },
        sixth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677423,
        },
        seventh: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677411,
        },
        eighth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677413,
        },
        nineth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677420,
        },
        tenth: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677420,
        },
        overflow1: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677425,
        },
        overflow2: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677425,
        },
        overflow3: {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677426,
        },
        '': {
          feature_gates: gates,
          dynamic_configs: configs,
          time: 1646026677409,
        },
      }),
    );
  });

  test('Verify loading a large list gets truncated', async () => {
    expect.assertions(16);
    const client = new StatsigClient(sdkKey, null);
    await client.initializeAsync();
    const store = client._store;
    expect(store).not.toBeNull();
    const storeObject = JSON.parse(
      localStorage.getItem(INTERNAL_STORE_KEY) ?? '',
    );

    // When we save the new user we initialized with, the limit will get applied
    expect(Object.keys(storeObject).length).toEqual(10);

    // empty string is correctly removed on save
    expect('' in storeObject).toBeFalsy();
    expect('third' in storeObject).toBeFalsy();
    expect('first' in storeObject).toBeFalsy();
    expect('second' in storeObject).toBeTruthy();
    expect('seventh' in storeObject).toBeFalsy();
    expect('eighth' in storeObject).toBeFalsy();
    expect('overflow3' in storeObject).toBeTruthy();

    let user = { userID: 'newUser' };
    let key = getUserCacheKey(user);
    await client.updateUser(user);
    store.save(user, {
      feature_gates: gates,
      dynamic_configs: configs,
    });

    expect(
      Object.keys(JSON.parse(localStorage.getItem(INTERNAL_STORE_KEY) ?? ''))
        .length,
    ).toEqual(10);

    user = { userID: 'newUser2' };
    key = getUserCacheKey(user);
    await client.updateUser(user);
    store.save(user, {
      feature_gates: gates,
      dynamic_configs: configs,
    });

    expect(
      Object.keys(JSON.parse(localStorage.getItem(INTERNAL_STORE_KEY) ?? ''))
        .length,
    ).toEqual(10);

    // Try adding back an empty string, verify something else is evicted
    user = { userID: '' };
    key = getUserCacheKey(user);
    await client.updateUser(user);
    store.save(user, {
      feature_gates: gates,
      dynamic_configs: configs,
    });

    expect(
      Object.keys(JSON.parse(localStorage.getItem(INTERNAL_STORE_KEY) ?? ''))
        .length,
    ).toEqual(10);

    expect(
      client._identity.getUserCacheKey() in
        JSON.parse(localStorage.getItem(INTERNAL_STORE_KEY) ?? ''),
    ).toBeTruthy();

    client.shutdown();

    const spyOnSet = jest.spyOn(localStorage, 'setItem');
    const spyOnGet = jest.spyOn(localStorage, 'getItem');

    const noStorageClient = new StatsigClient(sdkKey, null, {
      disableLocalStorage: true,
    });

    await noStorageClient.initializeAsync();
    expect(spyOnGet).toHaveBeenCalledTimes(0);
    expect(spyOnSet).toHaveBeenCalledTimes(0);

    // localStorage has 10 items, but because disableLocalStorage is true, we won't use them
    expect(
      Object.keys(JSON.parse(localStorage.getItem(INTERNAL_STORE_KEY) ?? ''))
        .length,
    ).toEqual(10);

    noStorageClient.shutdown();
  });
});
