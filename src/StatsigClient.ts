import DynamicConfig from './DynamicConfig';
import ErrorBoundary from './ErrorBoundary';
import {
  StatsigInvalidArgumentError,
  StatsigUninitializedError,
} from './Errors';
import Layer, { LogParameterFunction } from './Layer';
import StatsigIdentity from './StatsigIdentity';
import StatsigLogger from './StatsigLogger';
import StatsigNetwork from './StatsigNetwork';
import StatsigSDKOptions, { StatsigOptions } from './StatsigSDKOptions';
import StatsigStore, {
  EvaluationDetails,
  EvaluationReason,
  StoreGateFetchResult,
} from './StatsigStore';
import { StatsigUser } from './StatsigUser';
import StatsigLocalStorage from './utils/StatsigLocalStorage';
import { now } from './utils/Timing';
import makeLogEvent from './LogEvent';

export default class StatsigClient {
  private _ready: boolean;
  private _initCalled: boolean = false;
  private _pendingInitPromise: Promise<void> | null = null;
  private _startTime;

  readonly _identity: StatsigIdentity;
  readonly _errorBoundary: ErrorBoundary;
  readonly _network: StatsigNetwork;
  readonly _store: StatsigStore;
  readonly _logger: StatsigLogger;
  readonly _options: StatsigSDKOptions;

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
    this._startTime = now();
    this._errorBoundary = new ErrorBoundary(sdkKey);
    this._ready = false;
    this._options = new StatsigSDKOptions(options);
    StatsigLocalStorage.disabled = this._options.disableLocalStorage;
    this._identity = new StatsigIdentity(
      sdkKey,
      this._normalizeUser(user ?? null),
      this._options.overrideStableID,
    );
    this._network = new StatsigNetwork(
      this._options,
      this._identity,
      this._errorBoundary,
    );
    this._logger = new StatsigLogger(
      this._options,
      this._identity,
      this._network,
      this._errorBoundary,
    );
    this._store = new StatsigStore(
      this._identity,
      this._logger.logConfigDefaultValueFallback,
      this._options.initializeValues,
    );

    this._errorBoundary._setStatsigMetadata(this._identity._statsigMetadata);

    if (this._options.initializeValues != null) {
      this._ready = true;
      this._initCalled = true;

      setTimeout(() => this._delayedSetup(), 20);
    }
  }

  public setInitializeValues(initializeValues: Record<string, unknown>): void {
    this._errorBoundary._capture(
      'setInitializeValues',
      () => {
        this._store.bootstrap(initializeValues);
        if (!this._ready) {
          // the sdk is usable and considered initialized when configured
          // with initializeValues
          this._ready = true;
          this._initCalled = true;
        }
        // we wont have access to window/document/localStorage if these run on the server
        // so try to run whenever this is called
        this._logger.sendSavedRequests();
      },
      () => {
        this._ready = true;
        this._initCalled = true;
      },
    );
  }

  public async initializeAsync(): Promise<void> {
    return this._errorBoundary._capture(
      'initializeAsync',
      async () => {
        if (this._pendingInitPromise != null) {
          return this._pendingInitPromise;
        }
        if (this._ready) {
          return Promise.resolve();
        }

        this._initCalled = true;

        if (this._options.localMode) {
          return Promise.resolve();
        }

        const user = this._identity._user;
        this._pendingInitPromise = this._fetchAndSaveValues(
          user,
          this._options.initTimeoutMs,
        )
          .then(() => {
            return;
          })
          .catch((e) => {
            this._errorBoundary._logError(
              'initializeAsync:fetchAndSaveValues',
              e,
            );
            return { success: false, message: e.message };
          })
          .then(() => {
            return;
          })
          .finally(async () => {
            this._pendingInitPromise = null;
            this._ready = true;
            this._delayedSetup();
          });

        return this._pendingInitPromise;
      },
      () => {
        this._ready = true;
        this._initCalled = true;
        return Promise.resolve();
      },
    );
  }

  public getEvaluationDetails(): EvaluationDetails {
    return this._errorBoundary._capture(
      'getEvaluationDetails',
      () => {
        return this._store.getGlobalEvaluationDetails();
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
   * @returns {boolean} - value of a gate for the user. Gates are "off" (return false) by default
   * @throws Error if initialize() is not called first, or gateName is not a string
   */
  public checkGate(gateName: string): boolean {
    return this._errorBoundary._capture(
      'checkGate',
      () => {
        const result = this._checkGateImpl(gateName);
        this._logGateExposureImpl(gateName, result);
        return result.gate.value === true;
      },
      () => false,
    );
  }

  /**
   * Checks the value of a config for the current user
   * @param {string} configName - the name of the config to get
   * @returns {DynamicConfig} - value of a config for the user
   * @throws Error if initialize() is not called first, or configName is not a string
   */
  public getConfig(configName: string): DynamicConfig {
    return this._errorBoundary._capture(
      'getConfig',
      () => {
        const result = this._getConfigImpl(configName);
        this._logConfigExposureImpl(configName, result);
        return result;
      },
      () => this._getEmptyConfig(configName),
    );
  }

  public getExperiment(configName: string): DynamicConfig {
    return this.getConfig(configName);
  }

  public getLayer(layerName: string): Layer {
    return this._errorBoundary._capture(
      'getLayer',
      () => {
        return this._getLayerImpl(
          this._logLayerParameterExposureForLayer,
          layerName,
        );
      },
      () =>
        Layer._create(layerName, {}, '', this._getEvaluationDetailsForError()),
    );
  }

  public logEvent(
    eventName: string,
    value: string | number | null = null,
    metadata: Record<string, string> | null = null,
  ): void {
    this._errorBoundary._swallow('logEvent', () => {
      if (!this._logger || !this._identity._sdkKey) {
        throw new StatsigUninitializedError(
          'Must initialize() before logging events.',
        );
      }
      if (typeof eventName !== 'string' || eventName.length === 0) {
        return;
      }
      const event = makeLogEvent(
        eventName,
        this._identity._user,
        this._identity._statsigMetadata,
        value,
        metadata,
      );
      this._logger.log(event);
    });
  }

  public async updateUser(user: StatsigUser | null): Promise<boolean> {
    return this._errorBoundary._capture(
      'updateUser',
      async () => {
        if (!this.initializeCalled()) {
          throw new StatsigUninitializedError('Call initialize() first.');
        }

        this._identity._user = this._normalizeUser(user);
        this._store.updateUser();
        this._logger.resetDedupeKeys();

        if (this._pendingInitPromise != null) {
          await this._pendingInitPromise;
        }

        if (this._options.localMode) {
          return Promise.resolve(true);
        }

        const currentUser = this._identity._user;
        this._pendingInitPromise = this._fetchAndSaveValues(
          currentUser,
        ).finally(() => {
          this._pendingInitPromise = null;
        });

        return this._pendingInitPromise
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
    this._errorBoundary._swallow('shutdown', () => {
      this._logger.shutdown();
    });
  }

  /**
   * @returns The Statsig stable ID used for device level experiments
   */
  public getStableID(): string {
    return this._errorBoundary._capture(
      'getStableID',
      () => this._identity._statsigMetadata.stableID,
      () => '',
    );
  }

  public initializeCalled(): boolean {
    return this._initCalled;
  }

  // Private

  private _delayedSetup(): void {
    this._errorBoundary._swallow('delayedSetup', () => {
      this._identity.saveStableID();
      this._logger.sendSavedRequests().then(() => {
        /* noop */
      });
    });
  }

  private _normalizeUser(user: StatsigUser | null): StatsigUser {
    let userCopy: Record<string, unknown> = {};
    try {
      userCopy = JSON.parse(JSON.stringify(user));
    } catch (error) {
      throw new StatsigInvalidArgumentError(
        'User object must be convertable to JSON string.',
      );
    }

    if (this._options.environment != null) {
      userCopy.statsigEnvironment = this._options.environment;
    }
    return userCopy as StatsigUser;
  }

  private _ensureStoreLoaded(): void {
    if (!this._store.isLoaded()) {
      throw new StatsigUninitializedError(
        'Call and wait for initialize() to finish first.',
      );
    }
  }

  private _getEvaluationDetailsForError(): EvaluationDetails {
    return {
      time: Date.now(),
      reason: EvaluationReason.Error,
    };
  }

  private async _fetchAndSaveValues(
    user: StatsigUser | null,
    timeout: number = this._options.initTimeoutMs,
  ): Promise<void> {
    let sinceTime: number | null = null;
    sinceTime = this._store.getLastUpdateTime(user);

    return this._network
      .fetchValues(user, sinceTime, timeout)
      .eventually((json) => {
        if (json?.has_updates) {
          this._store.save(user, json, false);
        }
      })
      .then(async (json: Record<string, any>) => {
        return this._errorBoundary._swallow('fetchAndSaveValues', async () => {
          if (json?.has_updates) {
            await this._store.save(user, json);
          } else if (json?.is_no_content) {
            this._store.setEvaluationReason(
              EvaluationReason.NetworkNotModified,
            );
          }
        });
      });
  }

  private _checkGateImpl(gateName: string): StoreGateFetchResult {
    this._ensureStoreLoaded();
    if (typeof gateName !== 'string' || gateName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the gateName.',
      );
    }
    return this._store.checkGate(gateName);
  }

  private _logGateExposureImpl(
    gateName: string,
    fetchResult?: StoreGateFetchResult,
  ) {
    const isManualExposure = !fetchResult;
    const result = fetchResult ?? this._checkGateImpl(gateName);
    const gate = result.gate;

    this._logger.logGateExposure(
      this._identity._user,
      gateName,
      gate.value,
      gate.rule_id,
      gate.secondary_exposures,
      result.evaluationDetails,
      isManualExposure,
    );
  }

  private _getConfigImpl(configName: string): DynamicConfig {
    this._ensureStoreLoaded();
    if (typeof configName !== 'string' || configName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the configName.',
      );
    }

    return this._store.getConfig(configName);
  }

  private _logConfigExposureImpl(configName: string, config?: DynamicConfig) {
    const isManualExposure = !config;
    const localConfig = config ?? this._getConfigImpl(configName);

    this._logger.logConfigExposure(
      this._identity._user,
      configName,
      localConfig._ruleID,
      localConfig._secondaryExposures,
      localConfig._evaluationDetails,
      isManualExposure,
    );
  }

  private _getLayerImpl(
    logParameterFunction: LogParameterFunction | null,
    layerName: string,
  ): Layer {
    this._ensureStoreLoaded();
    if (typeof layerName !== 'string' || layerName.length === 0) {
      throw new StatsigInvalidArgumentError(
        'Must pass a valid string as the layerName.',
      );
    }

    return this._store.getLayer(logParameterFunction, layerName);
  }

  private _logLayerParameterExposureForLayer = (
    layer: Layer,
    parameterName: string,
    isManualExposure: boolean = false,
  ) => {
    let allocatedExperiment = '';
    let exposures = layer._undelegatedSecondaryExposures;
    const isExplicit = layer._explicitParameters.includes(parameterName);
    if (isExplicit) {
      allocatedExperiment = layer._allocatedExperimentName;
      exposures = layer._secondaryExposures;
    }

    this._logger.logLayerExposure(
      this._identity._user,
      layer._name,
      layer._ruleID,
      exposures,
      allocatedExperiment,
      parameterName,
      isExplicit,
      layer._evaluationDetails,
      isManualExposure,
    );
  };

  private _getEmptyConfig(configName: string): DynamicConfig {
    return new DynamicConfig(
      configName,
      {},
      '',
      this._getEvaluationDetailsForError(),
    );
  }
}
