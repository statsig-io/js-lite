/**
 * @jest-environment jsdom
 */

import StatsigClient from '../StatsigClient';
import { EvaluationReason } from '../StatsigStore';
import { getHashValue } from '../utils/Hashing';
import * as TestData from './initialize_response.json';
import LocalStorageMock from './LocalStorageMock';

describe('Statsig Client Bootstrapping', () => {
  const sdkKey = 'client-clienttestkey';
  var parsedRequestBody: Record<string, any> | null;
  // @ts-ignore
  global.fetch = jest.fn((url, params) => {
    if (
      url &&
      typeof url === 'string' &&
      url.includes('initialize') &&
      url !== 'https://featuregates.org/v1/initialize'
    ) {
      return Promise.reject(new Error('invalid initialize endpoint'));
    }
    parsedRequestBody = JSON.parse(params?.body as string);
    return Promise.resolve({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
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
          }),
        ),
    });
  });

  const localStorage = new LocalStorageMock();
  // @ts-ignore
  Object.defineProperty(window, 'localStorage', {
    value: localStorage,
  });

  beforeEach(() => {
    jest.resetModules();
    parsedRequestBody = null;
    window.localStorage.clear();
  });

  it('bootstraps with valid values', async () => {
    expect.assertions(14);

    const client = new StatsigClient(
      'client-xyz',
      { email: 'tore@statsig.com' },
      { initializeValues: TestData },
    );
    // usable immediately, without an async initialize
    expect(client.checkGate('test_gate')).toBe(false);
    expect(client.checkGate('i_dont_exist')).toBe(false);
    expect(client.checkGate('always_on_gate')).toBe(true);
    expect(client.checkGate('on_for_statsig_email')).toBe(true);
    expect(client.getConfig('test_config').get('number', 10)).toEqual(7);
    expect(client.getConfig('test_config')._evaluationDetails).toEqual({
      reason: EvaluationReason.Bootstrap,
      time: expect.any(Number),
    });

    expect(client.getEvaluationDetails()).toEqual({
      reason: EvaluationReason.Bootstrap,
      time: expect.any(Number),
    });

    await client.initializeAsync();
    // nothing changed, network not hit
    expect(parsedRequestBody).toBeNull();
    expect(client.checkGate('test_gate')).toBe(false);
    expect(client.checkGate('i_dont_exist')).toBe(false);
    expect(client.checkGate('always_on_gate')).toBe(true);
    expect(client.checkGate('on_for_statsig_email')).toBe(true);
    expect(client.getConfig('test_config').get('number', 10)).toEqual(7);
    expect(
      client.getLayer('c_layer_with_holdout').get('holdout_layer_param', 'x'),
    ).toEqual('layer_default');
  });

  it('uses defaults with bootstrap values is empty', async () => {
    expect.assertions(14);
    const spyOnSet = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const spyOnGet = jest.spyOn(window.localStorage.__proto__, 'getItem');

    const client = new StatsigClient(
      'client-xyz',
      { email: 'tore@statsig.com' },
      // optimal parameters to skip local storage entirely
      {
        initializeValues: {},
        overrideStableID: '999',
      },
    );
    expect(spyOnSet).not.toHaveBeenCalled();
    expect(spyOnGet).not.toBeCalled();

    // we get defaults everywhere else
    expect(client._identity._user).toEqual({ email: 'tore@statsig.com' });
    expect(client.checkGate('test_gate')).toBe(false);
    expect(client.checkGate('always_on_gate')).toBe(false);
    expect(client.checkGate('on_for_statsig_email')).toBe(false);
    expect(client.getConfig('test_config').get('number', 10)).toEqual(10);
    expect(client.getConfig('test_config')._evaluationDetails).toEqual({
      reason: EvaluationReason.Unrecognized,
      time: expect.any(Number),
    });

    client.updateUserWithValues({ email: 'kenny@statsig.com' }, TestData);
    // user updated along with the gate values
    expect(client._identity._user).toEqual({ email: 'kenny@statsig.com' });
    expect(client.checkGate('always_on_gate')).toBe(true);
    expect(client.checkGate('on_for_statsig_email')).toBe(true);
    expect(client.getConfig('test_config').get('number', 10)).toEqual(7);
    expect(client.getConfig('test_config')._evaluationDetails).toEqual({
      reason: EvaluationReason.Bootstrap,
      time: expect.any(Number),
    });

    expect(client.getEvaluationDetails()).toEqual({
      reason: EvaluationReason.Bootstrap,
      time: expect.any(Number),
    });
  });

  it('bootstrapping calls local storage for overrides and stableID', async () => {
    expect.assertions(3);

    const spyOnSet = jest.spyOn(window.localStorage.__proto__, 'setItem');
    const spyOnGet = jest.spyOn(window.localStorage.__proto__, 'getItem');

    const client = new StatsigClient(
      'client-xyz',
      { email: 'tore@statsig.com' },
      // default parameters dont skip local storage get calls
      { initializeValues: {} },
    );

    expect(spyOnSet).not.toHaveBeenCalled();

    expect(spyOnGet).toHaveBeenCalledTimes(1);
    expect(spyOnGet).toHaveBeenCalledWith('STATSIG_STABLE_ID');
  });

  it('reports InvalidBootstrap', () => {
    const client = new StatsigClient(
      'client-xyz',
      { userID: 'dloomb' },
      {
        initializeValues: {
          ...TestData,
          ...{ evaluated_keys: { userID: 'tore' } },
        },
      },
    );

    expect(client.getConfig('test_config')._evaluationDetails).toMatchObject({
      reason: EvaluationReason.InvalidBootstrap,
    });
  });
});
