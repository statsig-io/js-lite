/**
 * @jest-environment jsdom
 */

import DynamicConfig from '../DynamicConfig';
import { STORAGE_KEY as LOCAL_OVERRIDE_STORAGE_KEY } from '../LocalOverrides';
import StatsigClient from '../StatsigClient';
import { EvaluationReason } from '../StatsigStore';
import { INTERNAL_STORE_KEY, STATSIG_STABLE_ID_KEY } from '../utils/Constants';
import LocalStorageMock from './LocalStorageMock';

type InitializeResponse = {
  feature_gates: Record<string, Record<string, any>>;
  dynamic_configs: Record<string, Record<string, any>>;
};

function onConfigDefaultValueFallback() {}

function generateTestConfigs(
  value: any,
  inExperiment: boolean,
  active: boolean,
): InitializeResponse {
  return {
    feature_gates: {},
    dynamic_configs: {
      '100893': {
        value: { key: value },
        rule_id: 'default',
        secondary_exposures: [],
        is_device_based: false,
        is_user_in_experiment: inExperiment,
        is_experiment_active: active,
      },
      // device experiment
      '781499572': {
        value: { key: value },
        rule_id: 'default',
        secondary_exposures: [],
        is_device_based: true,
        is_user_in_experiment: inExperiment,
        is_experiment_active: active,
      },
      '2749703420': {
        value: { key: value },
        rule_id: 'default',
        secondary_exposures: [],
        is_device_based: false,
        is_user_in_experiment: inExperiment,
        is_experiment_active: active,
      },
    },
  };
}

describe('Verify behavior of InternalStore', () => {
  const sdkKey = 'client-internalstorekey';
  const now = Date.now();
  const feature_gates = {
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

  const config_obj = new DynamicConfig(
    'test_config',
    { bool: true },
    'default',
    { reason: EvaluationReason.Network, time: now },
    [
      {
        gate: 'dependent_gate_1',
        gateValue: 'true',
        ruleID: 'rule_1',
      },
    ],
    '',
    onConfigDefaultValueFallback,
  );

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
            gates: {},
            feature_gates: {
              '3114454104': {
                value: true,
                rule_id: 'ruleID123',
              },
            },
            dynamic_configs: configs,
            configs: {},
            has_updates: true,
          }),
        ),
    }),
  );

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    localStorage.clear();

    // ensure Date.now() returns the same value in each test
    jest.spyOn(global.Date, 'now').mockImplementation(() => now);
  });

  test('Verify top level function initializes instance variables.', () => {
    expect.assertions(2);
    const client = new StatsigClient(sdkKey, null);
    expect(client._store).not.toBeNull();
    return client.initializeAsync().then(() => {
      // @ts-ignore
      const store = client._store;
      expect(store).not.toBeNull();
    });
  });

  test('Verify save correctly saves into cache.', () => {
    expect.assertions(10);
    const spyOnSet = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const spyOnGet = jest.spyOn(window.localStorage.__proto__, 'getItem');
    const client = new StatsigClient(sdkKey);
    const store = client._store;

    expect(store.getGlobalEvaluationDetails()).toEqual({
      reason: EvaluationReason.Uninitialized,
      time: expect.any(Number),
    });
    store.save(null, {
      feature_gates: feature_gates,
      dynamic_configs: configs,
    });
    expect(store.getGlobalEvaluationDetails()).toEqual({
      reason: EvaluationReason.Network,
      time: now,
    });
    expect(spyOnSet).toHaveBeenCalledTimes(1); // stableid not saved by default

    expect(spyOnGet).toHaveBeenCalledTimes(3);
    expect(spyOnGet).toHaveBeenCalledWith(INTERNAL_STORE_KEY);
    expect(spyOnGet).toHaveBeenCalledWith(LOCAL_OVERRIDE_STORAGE_KEY);
    expect(spyOnGet).toHaveBeenCalledWith(STATSIG_STABLE_ID_KEY);

    const config = store.getConfig('test_config');
    expect(config).toMatchConfig(config_obj);
    expect(config._evaluationDetails).toEqual({
      reason: EvaluationReason.Network,
      time: now,
    });
    expect(store.checkGate('test_gate').gate.value).toEqual(true);
  });

  test('Verify cache before init and save correctly saves into cache.', () => {
    expect.assertions(10);
    const spyOnSet = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const spyOnGet = jest.spyOn(window.localStorage.__proto__, 'getItem');
    const client = new StatsigClient(sdkKey);
    expect(spyOnSet).toHaveBeenCalledTimes(0);
    const store = client._store;
    expect(store.getConfig('test_config')._evaluationDetails.reason).toEqual(
      EvaluationReason.Uninitialized,
    );

    store.save(null, {
      feature_gates: feature_gates,
      dynamic_configs: configs,
    });
    expect(spyOnSet).toHaveBeenCalledTimes(1);

    expect(spyOnGet).toHaveBeenCalledTimes(3);
    expect(spyOnGet).toHaveBeenCalledWith(INTERNAL_STORE_KEY);
    expect(spyOnGet).toHaveBeenCalledWith(LOCAL_OVERRIDE_STORAGE_KEY);
    expect(spyOnGet).toHaveBeenCalledWith(STATSIG_STABLE_ID_KEY);

    const config = store.getConfig('test_config');
    expect(config).toMatchConfig(config_obj);
    expect(config._evaluationDetails).toEqual({
      reason: EvaluationReason.Network,
      time: now,
    });
    expect(store.checkGate('test_gate').gate.value).toEqual(true);
  });

  test('Verify local storage usage with override id', () => {
    expect.assertions(8);

    const spyOnSet = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const spyOnGet = jest.spyOn(window.localStorage.__proto__, 'getItem');
    const client = new StatsigClient(sdkKey, {}, { overrideStableID: '999' });
    expect(spyOnSet).toHaveBeenCalledTimes(0);
    const store = client._store;
    expect(store.getConfig('test_config')._evaluationDetails.reason).toEqual(
      EvaluationReason.Uninitialized,
    );

    store.save(null, {
      feature_gates: feature_gates,
      dynamic_configs: configs,
    });

    expect(spyOnGet).toHaveBeenCalledTimes(2);
    expect(spyOnSet).not.toHaveBeenCalledWith(STATSIG_STABLE_ID_KEY);

    // @ts-ignore
    client._delayedSetup();

    expect(spyOnSet).toHaveBeenCalledWith(STATSIG_STABLE_ID_KEY, '999'); // only now do we save the stableid
    const config = store.getConfig('test_config');
    expect(config).toMatchConfig(config_obj);
    expect(config._evaluationDetails).toEqual({
      reason: EvaluationReason.Network,
      time: now,
    });
    expect(store.checkGate('test_gate').gate.value).toEqual(true);
  });

  test('Verify checkGate returns false when gateName does not exist.', () => {
    expect.assertions(1);
    const client = new StatsigClient(sdkKey, { userID: 'user_key' });
    return client.initializeAsync().then(() => {
      const store = client._store;
      const result = store.checkGate('fake_gate').gate.value;
      expect(result).toBe(false);
    });
  });

  test('Verify checkGate returns the correct value.', () => {
    expect.assertions(2);
    const client = new StatsigClient(sdkKey, { userID: 'user_key' });
    return client.initializeAsync().then(() => {
      expect(client._store.checkGate('test_gate').gate.value).toBe(true);
      expect(client._store.checkGate('3114454104').gate.value).toBe(false);
    });
  });

  test('Verify getConfig returns a dummy config and logs exposure when configName does not exist.', () => {
    expect.assertions(4);
    const client = new StatsigClient(sdkKey, { userID: 'user_key' });
    return client.initializeAsync().then(() => {
      const store = client._store;
      const config = store.getConfig('fake_config');
      expect(config._name).toEqual('fake_config');
      expect(config.getValue()).toEqual({});
      expect(config._ruleID).toEqual('');
      expect(config._evaluationDetails).toEqual({
        reason: EvaluationReason.Unrecognized,
        time: now,
      });
    });
  });

  test('Verify getConfig returns the correct value.', () => {
    expect.assertions(1);
    const client = new StatsigClient(sdkKey, { userID: 'user_key' });
    return client.initializeAsync().then(() => {
      const store = client._store;
      expect(store.getConfig('test_config').getValue()).toMatchObject({
        bool: true,
      });
    });
  });

  test('test user cache key when there are customIDs', async () => {
    expect.assertions(2);
    const statsig = new StatsigClient(sdkKey, {
      customIDs: { deviceId: '' },
    });
    await statsig.initializeAsync();
    const store = statsig._store;

    store.save(
      {
        customIDs: { deviceId: '' },
      },
      generateTestConfigs('v0', true, true),
    );
    expect(store.getConfig('exp').get('key', '')).toEqual('v0');

    // updateUser with the same userID but different customID
    await statsig.updateUser({
      customIDs: { deviceId: 'device_id_abc' },
    });

    store.save(
      {
        customIDs: { deviceId: 'device_id_abc' },
      },
      generateTestConfigs('v1', true, true),
    );
    expect(store.getConfig('exp').get('key', '')).toEqual('v1');
  });

  test('that we purge the oldest cache when we have more than 10', async () => {
    expect.assertions(2);
    const statsig = new StatsigClient(sdkKey, { userID: '1' });
    await statsig.initializeAsync();
    const store = statsig._store;

    await statsig.updateUser({ userID: '2' });
    store.save({ userID: '2' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '3' });
    store.save({ userID: '3' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '4' });
    store.save({ userID: '4' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '5' });
    store.save({ userID: '5' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '6' });
    store.save({ userID: '6' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '7' });
    store.save({ userID: '7' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '8' });
    store.save({ userID: '8' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '9' });
    store.save({ userID: '9' }, generateTestConfigs('v0', true, true));
    await statsig.updateUser({ userID: '10' });
    store.save({ userID: '10' }, generateTestConfigs('v0', true, true));
    const cache = JSON.parse(
      window.localStorage.getItem(INTERNAL_STORE_KEY) ?? '{}',
    );
    expect(Object.keys(cache).length).toEqual(10);

    await statsig.updateUser({ userID: '11' });
    store.save({ userID: '11' }, generateTestConfigs('v0', true, true));

    expect(Object.keys(cache).length).toEqual(10);
  });
});
