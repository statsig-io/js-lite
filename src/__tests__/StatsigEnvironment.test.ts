/**
 * @jest-environment jsdom
 */

import Statsig from '..';

describe('StatsigEnvironment', () => {
  let requests: { url: string; body: Record<string, any> }[];

  //@ts-ignore
  global.fetch = jest.fn((url, params) => {
    requests.push({
      url: url.toString(),
      body: JSON.parse(params?.body?.toString() ?? '{}'),
    });

    return Promise.resolve({ ok: true, text: () => Promise.resolve('{}') });
  });

  beforeEach(() => {
    requests = [];
    (Statsig as any).instance = null;
  });

  it('leaves environment blank for single user initialize calls', async () => {
    await Statsig.initialize('client-key', { userID: 'initial_user' });
    const { url, body } = requests[0];

    expect(requests.length).toBe(1);
    expect(url).toContain('/v1/download_config_specs');
    expect(body.user.statsigEnvironment).toBeUndefined();
    expect(body.user.userID).toEqual('initial_user');
  });

  it('applies environment to single user initialize calls', async () => {
    await Statsig.initialize(
      'client-key',
      { userID: 'initial_user' },
      { environment: { tier: 'development' } },
    );
    const { url, body } = requests[0];

    expect(requests.length).toBe(1);
    expect(url).toContain('/v1/download_config_specs');
    expect(body.user.statsigEnvironment).toEqual({
      tier: 'development',
    });
    expect(body.user.userID).toEqual('initial_user');
  });

  it('applies environment to null user initialize calls', async () => {
    await Statsig.initialize('client-key', null, {
      environment: { tier: 'development' },
    });
    const { url, body } = requests[0];

    expect(requests.length).toBe(1);
    expect(url).toContain('/v1/download_config_specs');
    expect(body.user.statsigEnvironment).toEqual({
      tier: 'development',
    });
    expect(body.user.userID).toBeUndefined();
  });
});
