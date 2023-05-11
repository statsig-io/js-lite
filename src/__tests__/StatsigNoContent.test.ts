/**
 * @jest-environment jsdom
 */

import { EvaluationReason } from '..';
import StatsigClient from '../StatsigClient';

describe('Verify behavior of StatsigClient when 204 returned from initialize', () => {
  const sdkKey = 'client-clienttestkey';
  var parsedRequestBody;
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
      status: 204,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            feature_gates: {
              '3114454104': {
                value: true,
                rule_id: 'ruleID123',
              },
            },
            dynamic_configs: {
              '3591394191': {
                value: {
                  num: 4,
                },
              },
            },
            has_updates: true,
          }),
        ),
    });
  });

  beforeEach(() => {
    jest.resetModules();
    parsedRequestBody = null;
  });

  test('Test status 204 response is a noop', async () => {
    expect.assertions(2);
    const statsig = new StatsigClient(sdkKey, { userID: '123' });
    await statsig.initializeAsync();

    expect(statsig.checkGate('test_gate')).toBe(false);
    // @ts-ignore
    expect(statsig._store._reason).toBe(EvaluationReason.NetworkNotModified);
  });
});
