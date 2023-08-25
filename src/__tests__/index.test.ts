/**
 * @jest-environment jsdom
 */

import Statsig from '..';
import makeLogEvent from '../LogEvent';
import { EvaluationReason } from '../EvaluationMetadata';
import { INTERNAL_STORE_KEY } from '../utils/Constants';
import * as TestData from './basic_config_spec.json';
let statsig: typeof Statsig;

export type StatsigInitializeResponse = {
  feature_gates: Record<string, any>;
  dynamic_configs: Record<string, any>;
  layer_configs: Record<string, any>;
  sdkParams: Record<string, any>;
  has_updates: boolean;
  time: number;
};

describe('Verify behavior of top level index functions', () => {
  let postedLogs = {
    events: [],
    statsigMetadata: { sdkType: '', sdkVersion: '' },
  };
  let requestCount = 0;
  // @ts-ignore
  global.fetch = jest.fn((url, params) => {
    if (url.toString().includes('rgstr')) {
      postedLogs = JSON.parse(params?.body as string);
      return Promise.resolve({ ok: true });
    }
    if (url.toString().includes('download_config_specs')) {
      requestCount++;
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(TestData)),
      });
    }
  });

  const str_64 =
    '1234567890123456789012345678901234567890123456789012345678901234';
  beforeEach(() => {
    jest.resetModules();
    statsig = require('../index').default;
    expect.hasAssertions();
    requestCount = 0;
    window.localStorage.removeItem(INTERNAL_STORE_KEY);

    // ensure Date.now() returns the same value in each test
    let now = Date.now();
    jest.spyOn(global.Date, 'now').mockImplementation(() => now);
  });

  test('Verify checkGate throws when calling before initialize', () => {
    expect(() => {
      statsig.checkGate({}, 'gate_that_doesnt_exist');
    }).toThrowError('Call and wait for initialize() to finish first.');
    // @ts-ignore
    expect(statsig.instance).toBeNull();
  });

  test('Verify checkGate throws with no gate name', () => {
    return statsig.initialize('client-key', null).then(() => {
      expect(() => {
        // @ts-ignore
        statsig.checkGate({});
      }).toThrowError('Must pass a valid string as the gateName.');
    });
  });

  test('Verify checkGate throws with wrong type as gate name', () => {
    return statsig.initialize('client-key', null).then(() => {
      expect(() => {
        // @ts-ignore
        statsig.checkGate({}, false);
      }).toThrowError('Must pass a valid string as the gateName.');
    });
  });

  test('Verify getConfig() and getExperiment() throw with no config name', () => {
    expect.assertions(2);
    return statsig.initialize('client-key', null).then(() => {
      expect(() => {
        // @ts-ignore
        statsig.getConfig({});
      }).toThrowError('Must pass a valid string as the configName.');
      expect(() => {
        // @ts-ignore
        statsig.getExperiment({});
      }).toThrowError('Must pass a valid string as the configName.');
    });
  });

  test('Verify getConfig and getExperiment() throw with wrong type as config name', () => {
    expect.assertions(2);
    return statsig.initialize('client-key', null).then(() => {
      expect(() => {
        // @ts-ignore
        statsig.getConfig({}, 12);
      }).toThrowError('Must pass a valid string as the configName.');
      expect(() => {
        // @ts-ignore
        statsig.getExperiment({}, 12);
      }).toThrowError('Must pass a valid string as the configName.');
    });
  });

  test('Verify getConfig and getExperiment throw when calling before initialize', () => {
    expect.assertions(3);
    expect(() => {
      statsig.getConfig({}, 'config_that_doesnt_exist');
    }).toThrowError('Call and wait for initialize() to finish first.');
    expect(() => {
      statsig.getExperiment({}, 'config_that_doesnt_exist');
    }).toThrowError('Call and wait for initialize() to finish first.');
    // @ts-ignore
    expect(statsig.instance).toBeNull();
  });

  test('Verify logEvent throws if called before initialize()', () => {
    expect(() => {
      statsig.logEvent({}, 'test_event');
    }).toThrowError('Call and wait for initialize() to finish first.');
    // @ts-ignore
    expect(statsig.instance).toBeNull();
  });

  test('Verify checkGate() returns the correct value under correct circumstances', () => {
    expect.assertions(4);
    return statsig
      .initialize('client-key', { disableCurrentPageLogging: true })
      .then(() => {
        // @ts-ignore
        const ready = statsig.instance._ready;
        expect(ready).toBe(true);

        //@ts-ignore
        const spy = jest.spyOn(statsig.instance._logger, 'log');
        let gateExposure = makeLogEvent(
          'statsig::gate_exposure',
          expect.objectContaining({email: 'test@statsig.com'}),
          (statsig as any).instance._identity._statsigMetadata,
          null,
          {
            gate: 'test_gate',
            gateValue: String(true),
            ruleID: '5NfZsHpOUSn3ts7koLusbK',
            reason: EvaluationReason.Network,
            time: Date.now(),
          },
          [],
        );

        const gateValue = statsig.checkGate({email: 'test@statsig.com'}, 'test_gate');
        expect(gateValue).toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(gateExposure);
      });
  });

  test('Initialize rejects invalid SDK Key', () => {
    // @ts-ignore
    return expect(statsig.initialize()).rejects.toEqual(
      new Error(
        'Invalid key provided.  You must use a Client SDK Key from the Statsig console to initialize the sdk',
      ),
    );
  });

  test('Verify getConfig() behaves correctly when calling under correct conditions', () => {
    expect.assertions(4);

    return statsig
      .initialize('client-key', { disableCurrentPageLogging: true })
      .then(() => {
        // @ts-ignore
        const ready = statsig.instance._ready;
        expect(ready).toBe(true);

        //@ts-ignore
        const spy = jest.spyOn(statsig.instance._logger, 'log');

        const configExposure = makeLogEvent(
          'statsig::config_exposure',
          expect.objectContaining({}),
          (statsig as any).instance._identity._statsigMetadata,
          null,
          {
            config: 'test_config',
            ruleID: 'default',
            reason: EvaluationReason.Network,
            time: Date.now(),
          },
          [],
        );

        const config = statsig.getConfig({}, 'test_config');
        expect(config?.value).toStrictEqual({
          bool: true,
          number: 2,
          double: 3.1,
          string: 'string',
          object: {
            key: 'value',
            key2: 123,
          },
          boolStr1: 'true',
          boolStr2: 'FALSE',
          numberStr1: '3',
          numberStr2: '3.3',
          numberStr3: '3.3.3',
        });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(configExposure);
      });
  });

  test('Verify getExperiment() behaves correctly when calling under correct conditions', () => {
    expect.assertions(4);

    return statsig
      .initialize('client-key', { disableCurrentPageLogging: true })
      .then(() => {
        // @ts-ignore
        const ready = statsig.instance._ready;
        expect(ready).toBe(true);

        //@ts-ignore
        const spy = jest.spyOn(statsig.instance._logger, 'log');
        const configExposure = makeLogEvent(
          'statsig::config_exposure',
          expect.objectContaining({}),
          (statsig as any).instance._identity._statsigMetadata,
          null,
          {
            config: 'test_config',
            ruleID: 'default',
            reason: EvaluationReason.Network,
            time: Date.now(),
          },
          [],
        );

        const exp = statsig.getExperiment({}, 'test_config');
        expect(exp?.value).toStrictEqual({
          bool: true,
          number: 2,
          double: 3.1,
          string: 'string',
          object: {
            key: 'value',
            key2: 123,
          },
          boolStr1: 'true',
          boolStr2: 'FALSE',
          numberStr1: '3',
          numberStr2: '3.3',
          numberStr3: '3.3.3',
        });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(configExposure);
      });
  });

  test('calling initialize() multiple times work as expected', async () => {
    expect.assertions(5);

    // initialize() twice simultaneously reulsts in 1 promise
    const v1 = statsig.initialize('client-key');
    const v2 = statsig.initialize('client-key');
    await expect(v1).resolves.not.toThrow();
    await expect(v2).resolves.not.toThrow();
    expect(requestCount).toEqual(1);

    // initialize() again after the first one completes resolves right away and does not make a new request
    await expect(statsig.initialize('client-key')).resolves.not.toThrow();
    expect(requestCount).toEqual(1);
  });

  test('shutdown does flush logs and they are correct', async () => {
    expect.assertions(8);
    const user = {
      userID: '12345',
      country: 'US',
      email: 'test@statsig.com',
      custom: { key: 'value' },
      privateAttributes: { private: 'value' },
    };
    await statsig.initialize('client-key');
    expect(statsig.checkGate(user, 'test_gate')).toEqual(true);
    const config = statsig.getConfig(user, 'test_config');
    expect(config?.value).toStrictEqual({
      bool: true,
      number: 2,
      double: 3.1,
      string: 'string',
      object: {
        key: 'value',
        key2: 123,
      },
      boolStr1: 'true',
      boolStr2: 'FALSE',
      numberStr1: '3',
      numberStr2: '3.3',
      numberStr3: '3.3.3',
    });
    statsig.logEvent(user, 'test_event', 'value', { key: 'value' });
    statsig.shutdown();
    expect(postedLogs['events'].length).toEqual(3);
    expect(postedLogs['events'][0]).toEqual(
      expect.objectContaining({
        eventName: 'statsig::gate_exposure',
        metadata: {
          gate: 'test_gate',
          gateValue: 'true',
          ruleID: '5NfZsHpOUSn3ts7koLusbK',
          reason: EvaluationReason.Network,
          time: expect.any(Number),
        },
        secondaryExposures: [],
        user: expect.objectContaining({
          userID: '12345',
          country: 'US',
          custom: { key: 'value' },
          email: "test@statsig.com",
        }),
        statsigMetadata: expect.any(Object),
        time: expect.any(Number),
        value: null,
      }),
    );
    expect(postedLogs['events'][1]).toEqual(
      expect.objectContaining({
        eventName: 'statsig::config_exposure',
        metadata: {
          config: 'test_config',
          ruleID: 'default',
          reason: EvaluationReason.Network,
          time: expect.any(Number),
        },
        secondaryExposures: [],
        user: expect.objectContaining({
          userID: '12345',
          country: 'US',
          custom: { key: 'value' },
          email: "test@statsig.com",
        }),
        statsigMetadata: expect.any(Object),
        time: expect.any(Number),
        value: null,
      }),
    );
    expect(postedLogs['events'][2]).toEqual(
      expect.objectContaining({
        eventName: 'test_event',
        metadata: {
          key: 'value',
        },
        user: expect.objectContaining({
          userID: '12345',
          country: 'US',
          custom: { key: 'value' },
          email: "test@statsig.com",
        }),
        statsigMetadata: expect.any(Object),
        time: expect.any(Number),
        value: 'value',
      }),
    );
    expect(postedLogs['events'][2]).toEqual(
      expect.not.objectContaining({ secondaryExposures: expect.anything() }),
    );

    expect(postedLogs['statsigMetadata']).toEqual(
      expect.objectContaining({
        sdkType: 'local-eval-js',
        sdkVersion: expect.any(String),
        stableID: expect.any(String),
      }),
    );
  });

  test('set and get stableID', async () => {
    await statsig.initialize(
      'client-key',
      { overrideStableID: '666' },
    );
    expect(statsig.getStableID()).toEqual('666');
  });
});
