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
    expect(url).toContain('/v1/initialize');
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
    expect(url).toContain('/v1/initialize');
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
    expect(url).toContain('/v1/initialize');
    expect(body.user.statsigEnvironment).toEqual({
      tier: 'development',
    });
    expect(body.user.userID).toBeUndefined();
  });

  describe('After Initialized [With Environment]', () => {
    beforeEach(async () => {
      await Statsig.initialize('client-key', null, {
        environment: { tier: 'development' },
      });
      requests = [];
    });

    it('applies environment to updateUser calls', async () => {
      await Statsig.updateUser({ userID: 'updated_user' });
      const { url, body } = requests[0];

      expect(requests.length).toBe(1);
      expect(url).toContain('/v1/initialize');
      expect(body.user.statsigEnvironment).toEqual({
        tier: 'development',
      });
      expect(body.user.userID).toEqual('updated_user');
    });
  });

  describe('After Initialized [Without Environment]', () => {
    beforeEach(async () => {
      await Statsig.initialize('client-key', null);
      requests = [];
    });

    it('leaves environment blank for updateUser calls', async () => {
      await Statsig.updateUser({ userID: 'updated_user' });
      const { url, body } = requests[0];

      expect(requests.length).toBe(1);
      expect(url).toContain('/v1/initialize');
      expect(body.user.statsigEnvironment).toBeUndefined();
      expect(body.user.userID).toEqual('updated_user');
    });
  });
});
