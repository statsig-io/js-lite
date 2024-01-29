const DEFAULT_FEATURE_GATE_API = 'https://featuregates.org/v1/';
const DEFAULT_EVENT_LOGGING_API = 'https://events.statsigapi.net/v1/';

export const INIT_TIMEOUT_DEFAULT_MS = 3000;

export type StatsigEnvironment = {
  tier?: 'production' | 'staging' | 'development' | string;
  [key: string]: string | undefined;
};

export type UpdateUserCompletionCallback = (
  durationMs: number,
  success: boolean,
  message: string | null,
) => void;

export type StatsigOptions = {
  api?: string;
  disableCurrentPageLogging?: boolean;
  environment?: StatsigEnvironment;
  loggingIntervalMillis?: number;
  loggingBufferMaxSize?: number;
  disableNetworkKeepalive?: boolean;
  overrideStableID?: string;
  localMode?: boolean;
  initTimeoutMs?: number;
  disableErrorLogging?: boolean;
  disableAutoMetricsLogging?: boolean;
  initializeValues?: Record<string, any> | null;
  eventLoggingApi?: string;
  disableLocalStorage?: boolean;
  ignoreWindowUndefined?: boolean;
  updateUserCompletionCallback?: UpdateUserCompletionCallback;
  disableAllLogging?: boolean;
};

type BoundedNumberInput = {
  default: number;
  min: number;
  max: number;
};

export default class StatsigSDKOptions {
  readonly api: string;
  readonly disableCurrentPageLogging: boolean;
  readonly environment: StatsigEnvironment | null;
  readonly loggingIntervalMillis: number;
  readonly loggingBufferMaxSize: number;
  readonly disableNetworkKeepalive: boolean;
  readonly overrideStableID: string | null;
  readonly localMode: boolean;
  readonly initTimeoutMs: number;
  readonly disableErrorLogging: boolean;
  readonly disableAutoMetricsLogging: boolean;
  readonly initializeValues: Record<string, any> | null;
  readonly eventLoggingApi: string;
  readonly disableLocalStorage: boolean;
  readonly ignoreWindowUndefined: boolean;
  readonly updateUserCompletionCallback: UpdateUserCompletionCallback | null;
  readonly disableAllLogging: boolean;

  constructor(options?: StatsigOptions | null) {
    if (options == null) {
      options = {};
    }
    let api = options.api ?? DEFAULT_FEATURE_GATE_API;
    this.api = api.endsWith('/') ? api : api + '/';
    this.disableCurrentPageLogging = options.disableCurrentPageLogging ?? false;
    this.environment = options.environment ?? null;
    this.loggingIntervalMillis = this.normalizeNumberInput(
      options.loggingIntervalMillis,
      {
        default: 10000,
        min: 1000,
        max: 60000,
      },
    );
    this.loggingBufferMaxSize = this.normalizeNumberInput(
      options.loggingBufferMaxSize,
      {
        default: 100,
        min: 2,
        max: 500,
      },
    );

    this.disableNetworkKeepalive = options.disableNetworkKeepalive ?? false;
    this.overrideStableID = options.overrideStableID ?? null;
    this.localMode = options.localMode ?? false;
    this.initTimeoutMs =
      options.initTimeoutMs && options.initTimeoutMs >= 0
        ? options.initTimeoutMs
        : INIT_TIMEOUT_DEFAULT_MS;
    this.disableErrorLogging = options.disableErrorLogging ?? false;
    this.disableAutoMetricsLogging = options.disableAutoMetricsLogging ?? false;
    this.initializeValues = options.initializeValues ?? null;
    let eventLoggingApi =
      options.eventLoggingApi ?? options.api ?? DEFAULT_EVENT_LOGGING_API;
    this.eventLoggingApi = eventLoggingApi.endsWith('/')
      ? eventLoggingApi
      : eventLoggingApi + '/';
    this.disableLocalStorage = options.disableLocalStorage ?? false;
    this.ignoreWindowUndefined = options?.ignoreWindowUndefined ?? false;
    this.updateUserCompletionCallback =
      options?.updateUserCompletionCallback ?? null;
    this.disableAllLogging = options?.disableAllLogging ?? false;
  }

  private normalizeNumberInput(
    input: number | undefined,
    bounds: BoundedNumberInput,
  ): number {
    if (input == null) {
      return bounds.default;
    }
    return Math.max(Math.min(input, bounds.max), bounds.min);
  }
}
