import DynamicConfig from './DynamicConfig';
import ErrorBoundary from './ErrorBoundary';
import {
  StatsigInvalidArgumentError,
  StatsigUninitializedError,
} from './Errors';
import Layer, { LogParameterFunction } from './Layer';
import LogEvent from './LogEvent';
import StatsigIdentity from './StatsigIdentity';
import StatsigLogger from './StatsigLogger';
import StatsigNetwork from './StatsigNetwork';
import StatsigSDKOptions, {
  INIT_TIMEOUT_DEFAULT_MS,
  StatsigOptions,
} from './StatsigSDKOptions';
import StatsigStore, {
  EvaluationDetails,
  EvaluationReason,
  StoreGateFetchResult,
} from './StatsigStore';
import { StatsigUser } from './StatsigUser';
import { getUserCacheKey } from './utils/Hashing';
import StatsigLocalStorage from './utils/StatsigLocalStorage';
import Diagnostics, {
  DiagnosticsEvent,
  DiagnosticsKey,
} from './utils/Diagnostics';
import { now } from './utils/Timing';

const MAX_VALUE_SIZE = 64;
const MAX_OBJ_SIZE = 2048;

export interface IStatsig {
  initializeAsync(): Promise<void>;
  checkGate(gateName: string): boolean;
  getConfig(configName: string): DynamicConfig;
  logEvent(
    eventName: string,
    value?: string | number | null,
    metadata?: Record<string, string> | null,
  ): void;
  updateUser(user: StatsigUser | null): Promise<boolean>;
  shutdown(): void;
  getStableID(): string;
}

export interface IHasStatsigInternal {
  getNetwork(): StatsigNetwork;
  getStore(): StatsigStore;
  getLogger(): StatsigLogger;
  getOptions(): StatsigSDKOptions;
  getCurrentUser(): StatsigUser | null;
  getCurrentUserCacheKey(): string;
  getSDKKey(): string;
  getStatsigMetadata(): Record<string, string | number>;
  getErrorBoundary(): ErrorBoundary;
  getSDKType(): string;
  getSDKVersion(): string;
}

export default class StatsigClient implements IHasStatsigInternal, IStatsig {

  private ready: boolean;
  private initCalled: boolean = false;
  private pendingInitPromise: Promise<void> | null = null;
  private startTime;

  private initializeDiagnostics: Diagnostics;

  private errorBoundary: ErrorBoundary;
  public getErrorBoundary(): ErrorBoundary {
    return this.errorBoundary;
  }

  private network: StatsigNetwork;
  public getNetwork(): StatsigNetwork {
    return this.network;
  }

  private store: StatsigStore;
  public getStore(): StatsigStore {
    return this.store;
  }

  private logger: StatsigLogger;
  public getLogger(): StatsigLogger {
    return this.logger;
  }

  private options: StatsigSDKOptions;
  public getOptions(): StatsigSDKOptions {
    return this.options;
  }

  private sdkKey: string | null;
  public getSDKKey(): string {
    if (this.sdkKey == null) {
      return '';
    }
    return this.sdkKey;
  }

  private identity: StatsigIdentity;
  public getCurrentUser(): StatsigUser | null {
    return this.identity.getUser();
  }
  public getCurrentUserCacheKey(): string {
    return getUserCacheKey(this.getCurrentUser());
  }

  public getStatsigMetadata(): Record<string, string | number> {
    return this.identity.getStatsigMetadata();
  }

  public getSDKType(): string {
    return this.identity.getSDKType();
  }

  public getSDKVersion(): string {
    return this.identity.getSDKVersion();
  }

  public constructor(
    sdkKey: string,
    user?: StatsigUser | null,
    options?: StatsigOptions | null,
  ) {
    if (
      options?.localMode !== true &&
      (typeof sdkKey !== 'string' || !sdkKey.startsWith('client-'))
    ) {
      throw new StatsigInvalidArgumentError(
        'Invalid key provided.  You must use a Client SDK Key from the Statsig console to initialize the sdk',
      );
    }
    this.startTime = now();
    this.errorBoundary = new ErrorBoundary(sdkKey);
    this.ready = false;
    this.sdkKey = sdkKey;
    this.options = new StatsigSDKOptions(options);
    StatsigLocalStorage.disabled = this.options.getDisableLocalStorage();
    this.initializeDiagnostics = new Diagnostics('initialize');
    this.identity = new StatsigIdentity(
      this.normalizeUser(user ?? null),
      this.options.getOverrideStableID(),
    );

    this.network = new StatsigNetwork(this);
    this.store = new StatsigStore(this, this.options.getInitializeValues());
    this.logger = new StatsigLogger(this);

    this.errorBoundary.setStatsigMetadata(this.getStatsigMetadata());

    if (this.options.getInitializeValues() != null) {
      this.ready = true;
      this.initCalled = true;

      setTimeout(() => this.delayedSetup(), 20);
    }
  }

  private delayedSetup(): void {
    this.errorBoundary.swallow('delayedSetup', () => {
      this.identity.saveStableID();
      this.logger.sendSavedRequests();
    });
  }

  public setInitializeValues(initializeValues: Record<string, unknown>): void {
    this.errorBoundary.capture(
      'setInitializeValues',
      () => {
        this.store.bootstrap(initializeValues);
        if (!this.ready) {
          // the sdk is usable and considered initialized when configured
          // with initializeValues
          this.ready = true;
          this.initCalled = true;
        }
        // we wont have access to window/document/localStorage if these run on the server
        // so try to run whenever this is called
        this.logger.sendSavedRequests();
      },
      () => {
        this.ready = true;
        this.initCalled = true;
      },
    );
  }

  public async initializeAsync(): Promise<void> {
    return this.errorBoundary.capture(
      'initializeAsync',
      async () => {
        if (this.pendingInitPromise != null) {
          return this.pendingInitPromise;
        }
        if (this.ready) {
          return Promise.resolve();
        }
        this.initializeDiagnostics.mark(
          DiagnosticsKey.OVERALL,
          DiagnosticsEvent.START,
        );
        this.initCalled = true;

        if (this.options.getLocalModeEnabled()) {
          return Promise.resolve();
        }

        const user = this.identity.getUser();
        this.pendingInitPromise = this.fetchAndSaveValues(
          user,
          this.options.getInitTimeoutMs(),
          this.initializeDiagnostics,
        )
          .then(() => {
            return;
          })
          .catch((e) => {
            this.errorBoundary.logError(
              'initializeAsync:fetchAndSaveValues',
              e,
            );
            return { success: false, message: e.message };
          })
          .then(() => {
            return;
          })
          .finally(async () => {
            this.pendingInitPromise = null;
            this.ready = true;
            this.delayedSetup();
            this.initializeDiagnostics.mark(
              DiagnosticsKey.OVERALL,
              DiagnosticsEvent.END,
            );
            if (!this.options.getDisableDiagnosticsLogging()) {
              this.logger.logDiagnostics(user, this.initializeDiagnostics);
            }
          });

        return this.pendingInitPromise;
      },
      () => {
        this.ready = true;
        this.initCalled = true;
        return Promise.resolve();
      },
    );
  }

  public getEvaluationDetails(): EvaluationDetails {
    return this.errorBoundary.capture(
      'getEvaluationDetails',
      () => {
        return this.store.getGlobalEvaluationDetails();
      },
      () => {
        return {
          time: Date.now(),
          reason: EvaluationReason.Error,
        };
      },
    );
  }

  /**
   * Checks the value of a gate for the current user
   * @param {string} gateName - the name of the gate to check
   * @param {boolean} ignoreOverrides = false if this check should ignore local overrides
   * @returns {boolean} - value of a gate for the user. Gates are "off" (return false) by default
   * @throws Error if initialize() is not called first, or gateName is not a string
   */
  public checkGate(
    gateName: string,
    ignoreOverrides: boolean = false,
  ): boolean {
    return this.errorBoundary.capture(
      'checkGate',
      () => {
        const result = this.checkGateImpl(gateName, ignoreOverrides);
        this.logGateExposureImpl(gateName, result);
        return result.gate.value === true;
      },
      () => false,
    );
  }

  /**
   * Checks the value of a config for the current user
   * @param {string} configName - the name of the config to get
   * @param {boolean} ignoreOverrides = false if this check should ignore local overrides
   * @returns {DynamicConfig} - value of a config for the user
   * @throws Error if initialize() is not called first, or configName is not a string
   */
  public getConfig(
    configName: string,
    ignoreOverrides: boolean = false,
  ): DynamicConfig {
    return this.errorBoundary.capture(
      'getConfig',
      () => {
        const result = this.getConfigImpl(configName);
        this.logConfigExposureImpl(configName, result);
        return result;
      },
      () => this.getEmptyConfig(configName),
    );
  }

  public getLayer(layerName: string, keepDeviceValue: boolean = false): Layer {
    return this.errorBoundary.capture(
      'getLayer',
      () => {
        return this.getLayerImpl(
          this.logLayerParameterExposureForLayer,
          layerName,
          keepDeviceValue,
        );
      },
      () =>
        Layer._create(layerName, {}, '', this.getEvalutionDetailsForError()),
    );
  }

  public logEvent(
    eventName: string,
    value: string | number | null = null,
    metadata: Record<string, string> | null = null,
  ): void {
    this.errorBoundary.swallow('logEvent', () => {
      if (!this.logger || !this.sdkKey) {
        throw new StatsigUninitializedError(
          'Must initialize() before logging events.',
        );
      }
      if (typeof eventName !== 'string' || eventName.length === 0) {
        return;
      }
      const event = new LogEvent(eventName);
      event.setValue(value);
      event.setMetadata(metadata);
      event.setUser(this.getCurrentUser());
      this.logger.log(event);
    });
  }

  public async updateUser(user: StatsigUser | null): Promise<boolean> {
    const updateStartTime = Date.now();

    return this.errorBoundary.capture(
      'updateUser',
      async () => {
        if (!this.initializeCalled()) {
          throw new StatsigUninitializedError('Call initialize() first.');
        }

        this.identity.updateUser(this.normalizeUser(user));
        this.logger.resetDedupeKeys();

        if (this.pendingInitPromise != null) {
          await this.pendingInitPromise;
        }

        if (this.options.getLocalModeEnabled()) {
          return Promise.resolve(true);
        }

        const currentUser = this.identity.getUser();
        this.pendingInitPromise = this.fetchAndSaveValues(currentUser).finally(
          () => {
            this.pendingInitPromise = null;
          },
        );

        return this.pendingInitPromise
          .then(() => {
            return Promise.resolve(true);
          })
          .catch((error) => {
            return Promise.resolve(false);
          });
      },
      () => {
        return Promise.resolve(false);
      },
    );
  }

  /**
   * Informs the statsig SDK that the client is closing or shutting down
   * so the SDK can clean up internal state
   */
  public shutdown(): void {
    this.errorBoundary.swallow('shutdown', () => {
      this.logger.shutdown();
    });
  }

  /**
   * @returns The Statsig stable ID used for device level experiments
   */
  public getStableID(): string {
    return this.errorBoundary.capture(
      'getStableID',
      () => this.identity.getStatsigMetadata().stableID,
      () => '',
    );
  }

  public initializeCalled(): boolean {
    return this.initCalled;
  }

  private normalizeUser(user: StatsigUser | null): StatsigUser {
    let userCopy: StatsigUser = {};
    try {
      userCopy = JSON.parse(JSON.stringify(user));
    } catch (error) {
      throw new StatsigInvalidArgumentError(
        'User object must be convertable to JSON string.',
      );
    }

    if (this.options.getEnvironment() != null) {
      // @ts-ignore
      userCopy.statsigEnvironment = this.options.getEnvironment();
    }
    return userCopy;
  }

  private ensureStoreLoaded(): void {
    if (!this.store.isLoaded()) {
      throw new StatsigUninitializedError(
        'Call and wait for initialize() to finish first.',
      );
    }
  }

  private getEvalutionDetailsForError(): EvaluationDetails {
    return {
      time: Date.now(),
      reason: EvaluationReason.Error,
    };
  }

  private async fetchAndSaveValues(
    user: StatsigUser | null,
    timeout: number = this.options.getInitTimeoutMs(),
    diagnostics?: Diagnostics,
  ): Promise<void> {

    let sinceTime: number | null = null;
    sinceTime = this.store.getLastUpdateTime(user);

    return this.network
      .fetchValues(
        user,
        sinceTime,
        timeout,
        diagnostics,
      )
      .eventually((json) => {
        if (json?.has_updates) {
          this.store.save(user, json, false);
        }
      })
      .then(async (json: Record<string, any>) => {
        return this.errorBoundary.swallow('fetchAndSaveValues', async () => {
          diagnostics?.mark(
            DiagnosticsKey.INITIALIZE,
            DiagnosticsEvent.START,
            'process',
          );
          if (json?.has_updates) {
            await this.store.save(user, json);
          } else if (json?.is_no_content) {
            this.store.setEvaluationReason(EvaluationReason.NetworkNotModified);
          }
          diagnostics?.mark(
            DiagnosticsKey.INITIALIZE,
            DiagnosticsEvent.END,
            'process',
          );
        });
      });
  }

  private checkGateImpl(
    gateName: string,
    ignoreOverrides: boolean,
  ): StoreGateFetchResult {
    this.ensureStoreLoaded();
    if (typeof gateName !== 'string' || gateName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the gateName.',
      );
    }
    return this.store.checkGate(gateName, ignoreOverrides);
  }

  private logGateExposureImpl(
    gateName: string,
    fetchResult?: StoreGateFetchResult,
  ) {
    const isManualExposure = !fetchResult;
    const result = fetchResult ?? this.checkGateImpl(gateName, false);
    const gate = result.gate;

    this.logger.logGateExposure(
      this.getCurrentUser(),
      gateName,
      gate.value,
      gate.rule_id,
      gate.secondary_exposures,
      result.evaluationDetails,
      isManualExposure,
    );
  }

  private getConfigImpl(
    configName: string,
  ): DynamicConfig {
    this.ensureStoreLoaded();
    if (typeof configName !== 'string' || configName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the configName.',
      );
    }

    return this.store.getConfig(configName);
  }

  private logConfigExposureImpl(configName: string, config?: DynamicConfig) {
    const isManualExposure = !config;
    const localConfig = config ?? this.getConfigImpl(configName);

    this.logger.logConfigExposure(
      this.getCurrentUser(),
      configName,
      localConfig.getRuleID(),
      localConfig._getSecondaryExposures(),
      localConfig.getEvaluationDetails(),
      isManualExposure,
    );
  }

  private getLayerImpl(
    logParameterFunction: LogParameterFunction | null,
    layerName: string,
    keepDeviceValue: boolean,
  ): Layer {
    this.ensureStoreLoaded();
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the layerName.',
      );
    }

    return this.store.getLayer(
      logParameterFunction,
      layerName,
    );
  }

  private logLayerParameterExposureForLayer = (
    layer: Layer,
    parameterName: string,
    isManualExposure: boolean = false,
  ) => {
    let allocatedExperiment = '';
    let exposures = layer._getUndelegatedSecondaryExposures();
    const isExplicit = layer._getExplicitParameters().includes(parameterName);
    if (isExplicit) {
      allocatedExperiment = layer._getAllocatedExperimentName();
      exposures = layer._getSecondaryExposures();
    }

    this.logger.logLayerExposure(
      this.getCurrentUser(),
      layer.getName(),
      layer.getRuleID(),
      exposures,
      allocatedExperiment,
      parameterName,
      isExplicit,
      layer._getEvaluationDetails(),
      isManualExposure,
    );
  };

  private getEmptyConfig(configName: string): DynamicConfig {
    return new DynamicConfig(
      configName,
      {},
      '',
      this.getEvalutionDetailsForError(),
    );
  }
}
