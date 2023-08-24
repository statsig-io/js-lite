/**
 * @jest-environment jsdom
 */

import Statsig from '..';
import { getHashValue } from '../utils/Hashing';

describe('ExposureLogging', () => {
  let events: {
    eventName: string;
    metadata: { gate?: string; config?: string; isManualExposure?: string };
  }[] = [];

  beforeEach(async () => {
    // @ts-ignore
    global.fetch = jest.fn((url, params) => {
      if (url.toString().includes('rgstr')) {
        const newEvents: typeof events = JSON.parse(params?.body as string)[
          'events'
        ];
        events.push(...newEvents);
      }

      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              feature_gates: {
                [getHashValue('a_gate')]: {
                  value: true,
                },
              },
              dynamic_configs: {
                [getHashValue('an_experiment')]: {
                  value: { a_bool: true },
                },
                [getHashValue('a_config')]: {
                  value: { a_bool: true },
                },
              },
              layer_configs: {
                [getHashValue('a_layer')]: {
                  value: { a_bool: true },
                },
              },
              sdkParams: {},
              has_updates: true,
              time: 1647984444418,
            }),
          ),
      });
    });

    events = [];

    // @ts-ignore
    Statsig.instance = null;
    await Statsig.initialize(
      'client-key',
      { userID: 'dloomb' },
      { initTimeoutMs: 1 },
    );

    // @ts-ignore
    Statsig.instance._options.loggingBufferMaxSize = 1;
  });

  afterEach(() => {
    Statsig.shutdown();
  });

  describe('standard use', () => {
    it('logs gate exposures', async () => {
      Statsig.checkGate('a_gate');
      expect(events.length).toBe(1);
      expect(events[0].metadata.gate).toEqual('a_gate');
      expect(events[0].metadata.isManualExposure).toBeUndefined();
      expect(events[0].eventName).toEqual('statsig::gate_exposure');
    });

    it('logs config exposures', async () => {
      Statsig.getConfig('a_config');
      expect(events.length).toBe(1);
      expect(events[0].metadata.config).toEqual('a_config');
      expect(events[0].metadata.isManualExposure).toBeUndefined();
      expect(events[0].eventName).toEqual('statsig::config_exposure');
    });

    it('logs experiment exposures', async () => {
      Statsig.getExperiment('an_experiment');
      expect(events.length).toBe(1);
      expect(events[0].metadata.config).toEqual('an_experiment');
      expect(events[0].metadata.isManualExposure).toBeUndefined();
      expect(events[0].eventName).toEqual('statsig::config_exposure');
    });

    // TODO @tore
    it.skip('logs layer exposures', async () => {
      const layer = Statsig.getLayer('a_layer');
      layer.get('a_bool', false);
      expect(events.length).toBe(1);
      expect(events[0].metadata.config).toEqual('a_layer');
      expect(events[0].metadata.isManualExposure).toBeUndefined();
      expect(events[0].eventName).toEqual('statsig::layer_exposure');
    });
  });
});
