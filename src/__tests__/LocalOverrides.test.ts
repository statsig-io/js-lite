/**
 * @jest-environment jsdom
 */

import Statsig from '..';
import { getHashValue } from '../utils/Hashing';

describe('Local Overrides', () => {
  let hasLoggedEvents = false;

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
    });

    hasLoggedEvents = false;
  });

  it('gets overridden values', () => {
    expect(Statsig.checkGate('test_gate')).toBe(false);
    expect(Statsig.getConfig('test_config').value).toEqual({ num: 1 });
    expect(Statsig.getExperiment('test_config').value).toEqual({ num: 1 });
  });

  describe('when overrides are removed', () => {
    beforeEach(() => {
      Statsig.setOverrides({
        gates: {},
        configs: {},
      });
    });

    afterEach(() => {
      Statsig.shutdown();
    });

    it('gets the actual values', () => {
      expect(Statsig.checkGate('test_gate')).toBe(true);
      expect(Statsig.getConfig('test_config').value).toEqual({ num: 4 });
      expect(Statsig.getExperiment('test_config').value).toEqual({ num: 4 });
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
