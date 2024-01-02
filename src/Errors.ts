export enum StatsigErrorMessage {
  REQUIRE_ASYNC_INITIALIZE = 'Call initialize() first.',
  REQUIRE_SYNC_INITIALIZE = 'Call and wait for initialize() to finish first.',
  REQUIRE_INITIALIZE_FOR_LOG_EVENT = 'Must initialize() before logging events.',
}

export class StatsigUninitializedError extends Error {
  constructor(message?: string) {
    super(message ?? StatsigErrorMessage.REQUIRE_SYNC_INITIALIZE);
    Object.setPrototypeOf(this, StatsigUninitializedError.prototype);
  }
}

export class StatsigInvalidArgumentError extends Error {
  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, StatsigInvalidArgumentError.prototype);
  }
}

export class StatsigSDKKeyMismatchError extends Error {
  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, StatsigSDKKeyMismatchError.prototype);
  }
}
