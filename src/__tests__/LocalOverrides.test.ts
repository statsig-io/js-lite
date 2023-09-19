/**
 * @jest-environment jsdom
 */

import Statsig from '..';
import { STORAGE_KEY } from '../LocalOverrides';
import { getHashValue } from '../utils/Hashing';
import LocalStorageMock from './LocalStorageMock';

describe('Local Overrides', () => {
  let hasLoggedEvents = false;

  const localStorage = new LocalStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: localStorage,
  });

  (global as any).fetch = jest.fn((url: string) => {
    if (url.includes('/initialize')) {
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
              layer_configs: {
                [getHashValue('test_layer')]: {
                  value: {
                    val: 'layer_default',
                  },
                },
              },
              has_updates: true,
              time: 123456789,
            }),
          ),
      });
    }

    if (url.includes('rgstr')) {
      hasLoggedEvents = true;
    }
  });

  beforeEach(async () => {
    await Statsig.initialize('client-key', null, {
      disableAutoMetricsLogging: true,
      disableCurrentPageLogging: true,
      disableErrorLogging: true,
    });

    Statsig.setOverrides({
      gates: { test_gate: false },
      configs: { test_config: { num: 1 } },
      layers: { test_layer: { val: 'override' } },
    });

    hasLoggedEvents = false;
  });

  it('gets overridden values', () => {
    expect(Statsig.checkGate('test_gate')).toBe(false);
    expect(Statsig.getConfig('test_config').value).toEqual({ num: 1 });
    expect(Statsig.getExperiment('test_config').value).toEqual({ num: 1 });
    expect(Statsig.getLayer('test_layer').getValue('val', 'err')).toBe(
      'override',
    );
  });

  it('persists to localStorage', () => {
    expect(localStorage).toMatchObject({
      [STORAGE_KEY]:
        '{"gates":{"test_gate":false},"configs":{"test_config":{"num":1}},"layers":{"test_layer":{"val":"override"}}}',
    });
  });

  describe('when overrides are removed', () => {
    beforeEach(() => {
      Statsig.setOverrides(null);
    });

    afterEach(() => {
      Statsig.shutdown();
    });

    it('gets the actual values', () => {
      expect(Statsig.checkGate('test_gate')).toBe(true);
      expect(Statsig.getConfig('test_config').value).toEqual({ num: 4 });
      expect(Statsig.getExperiment('test_config').value).toEqual({ num: 4 });
      expect(Statsig.getLayer('test_layer').getValue('val', 'err')).toBe(
        'layer_default',
      );
    });

    it('persists to localStorage', () => {
      expect(localStorage).toMatchObject({
        [STORAGE_KEY]: '{"gates":{},"configs":{},"layers":{}}',
      });
    });
  });

  describe('when shutdown', () => {
    beforeEach(() => {
      Statsig.shutdown();
    });

    it('does not log any events', () => {
      expect(hasLoggedEvents).toBe(false);
    });
  });
});
