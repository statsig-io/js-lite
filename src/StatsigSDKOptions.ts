export const DEFAULT_CONFIG_SPEC_API = 'https://dcs-worker.statsig.workers.dev/v1/';
export const DEFAULT_EVENT_LOGGING_API = 'https://events.statsigapi.net/v1/';

export const INIT_TIMEOUT_DEFAULT_MS = 3000;

export type StatsigEnvironment = {
  tier?: 'production' | 'staging' | 'development' | string;
  [key: string]: string | undefined;
};

export type StatsigOptions = {
  configSpecAPI?: string;
  eventLoggingAPI?: string;
  disableCurrentPageLogging?: boolean;
  environment?: StatsigEnvironment;
  loggingIntervalMillis?: number;
  loggingBufferMaxSize?: number;
  disableNetworkKeepalive?: boolean;
  overrideStableID?: string;
  localMode?: boolean;
  initTimeoutMs?: number;
  initializeValues?: Record<string, any> | null;
  disableLocalStorage?: boolean;
  ignoreWindowUndefined?: boolean;
};

type BoundedNumberInput = {
  default: number;
  min: number;
  max: number;
};

export default class StatsigSDKOptions {
  readonly configSpecAPI: string;
  readonly eventLoggingAPI: string;
  readonly disableCurrentPageLogging: boolean;
  readonly environment: StatsigEnvironment | null;
  readonly loggingIntervalMillis: number;
  readonly loggingBufferMaxSize: number;
  readonly disableNetworkKeepalive: boolean;
  readonly overrideStableID: string | null;
  readonly localMode: boolean;
  readonly initTimeoutMs: number;
  readonly initializeValues: Record<string, any> | null;
  readonly disableLocalStorage: boolean;
  readonly ignoreWindowUndefined: boolean;

  constructor(options?: StatsigOptions | null) {
    if (options == null) {
      options = {};
    }
    this.configSpecAPI = this.normalizeAPI(options.configSpecAPI, DEFAULT_CONFIG_SPEC_API);
    this.eventLoggingAPI = this.normalizeAPI(options.eventLoggingAPI, DEFAULT_EVENT_LOGGING_API);
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
    this.initializeValues = options.initializeValues ?? null;
    
    this.disableLocalStorage = options.disableLocalStorage ?? false;
    this.ignoreWindowUndefined = options?.ignoreWindowUndefined ?? false;
  }

  private normalizeAPI(
    input: string | undefined,
    defaultValue: string,
  ): string {
    let api = input ?? defaultValue;
    return api.endsWith('/') ? api : api + '/';
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
