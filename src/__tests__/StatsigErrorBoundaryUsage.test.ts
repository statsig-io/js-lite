/**
 * @jest-environment jsdom
 */

import DynamicConfig from '../DynamicConfig';
import { ExceptionEndpoint } from '../ErrorBoundary';
import Layer from '../Layer';
import StatsigClient from '../StatsigClient';

describe('Statsig ErrorBoundary Usage', () => {
  let requests: { url: RequestInfo; params: RequestInit }[] = [];
  let client: StatsigClient;
  let responseString: unknown = '{"has_updates": true}';
  const user = null;

  function expectSingleError(
    info: string,
    exception: 'TypeError' | 'SyntaxError' | 'Error' = 'TypeError',
    extra: Record<string, unknown> = {},
  ) {
    expect(requests.length).toBe(1);
    const request = requests[0];
    expect(request.url).toEqual(ExceptionEndpoint);
    const body = JSON.parse((request.params.body as string) ?? '');
    expect(body).toMatchObject({
      info: expect.stringContaining(info),
      exception,
      extra,
    });
  }

  beforeEach(async () => {
    responseString = '{"has_updates": true}';
    // @ts-ignore
    global.fetch = jest.fn((url, params) => {
      requests.push({ url: url.toString(), params: params ?? {} });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(responseString),
      });
    });

    client = new StatsigClient('client-key');
    await client.initializeAsync();

    // @ts-ignore
    client._errorBoundary.seen = new Set();
    requests = [];
    // Causes not a function errors
    // @ts-ignore
    client._store = { isLoaded: () => true };
    // @ts-ignore
    client._logger = 1;
  });

  it('recovers from errors and returns default gate value', async () => {
    const result = client.checkGate(user, 'a_gate');
    expect(result).toBe(false);
    expectSingleError('_store.checkGate');
  });

  it('recovers from errors and returns default config value', async () => {
    const result = client.getConfig(user, 'a_config');
    expect(result instanceof DynamicConfig).toBe(true);
    expectSingleError('_store.getConfig');
  });

  it('recovers from errors and returns default experiment value', async () => {
    const result = client.getExperiment(user, 'an_experiment');
    expect(result instanceof DynamicConfig).toBe(true);
    expectSingleError('_store.getConfig');
  });

  it.skip('recovers from errors and returns default layer value', async () => {
    const result = client.getLayer(user, 'a_layer');
    expect(result instanceof Layer).toBe(true);
    expectSingleError('_store.getLayer');
  });

  it('recovers from errors with logEvent', () => {
    client.logEvent(user, 'an_event');
    expectSingleError('_logger.log');
  });

  it('recovers from errors with shutdown', () => {
    client.shutdown();
    expectSingleError('_logger.shutdown');
  });

  it('recovers from errors with getStableID', () => {
    // @ts-ignore
    client._identity = 1;

    client.getStableID();

    expectSingleError(
      `Cannot read properties of undefined (reading 'stableID')`,
    );
  });

  it('recovers from errors with initialize', async () => {
    const localClient = new StatsigClient('client-key');
    // @ts-ignore
    localClient._network = 1;
    await localClient.initializeAsync();
    expectSingleError('_network.fetchValues');
    // @ts-ignore
    expect(localClient._ready).toBeTruthy();
  });

  it('captures crashes in saving', async () => {
    const localClient = new StatsigClient('client-key');
    // @ts-ignore
    localClient._store.save = null;
    await localClient.initializeAsync();
    requests.shift(); // remove the /initialize call
    expectSingleError('this._store.save is not a function');
  });

  it('captures the case when a non JSON 200 is returned', async () => {
    const localClient = new StatsigClient('client-key');
    responseString = 1;
    await localClient.initializeAsync();
    requests.shift(); // rm /initialize call
    expectSingleError(
      "Error: Request to download_config_specs received invalid response type. Expected 'object' but got 'number'",
      'Error',
      expect.objectContaining({
        requestInfo: expect.any(Object),
        responseInfo: expect.any(Object),
      }),
    );
  });

});
