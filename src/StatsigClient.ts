import DynamicConfig from './DynamicConfig';
import ErrorBoundary from './ErrorBoundary';
import {
  StatsigErrorMessage,
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
import { verifySDKKeyUsed } from './utils/ResponseVerification';
import StatsigLocalStorage from './utils/StatsigLocalStorage';
import { now } from './utils/Timing';
import makeLogEvent from './LogEvent';
import {
  LocalOverrides,
  loadOverridesFromLocalStorage,
  makeEmptyOverrides,
  saveOverridesToLocalStorage,
} from './LocalOverrides';

export default class StatsigClient {
  private _ready: boolean;
  private _initCalled: boolean = false;
  private _pendingInitPromise: Promise<void> | null = null;
  private _startTime;
  private _overrides: LocalOverrides;

  readonly _identity: StatsigIdentity;
  readonly _errorBoundary: ErrorBoundary;
  readonly _network: StatsigNetwork;
  readonly _store: StatsigStore;
  readonly _logger: StatsigLogger;
  readonly _options: StatsigSDKOptions;
  readonly _sdkKey: string | null = null;

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
    this._sdkKey = sdkKey;
    this._startTime = now();
    this._errorBoundary = new ErrorBoundary(sdkKey);
    this._ready = false;
    this._options = new StatsigSDKOptions(options);
    StatsigLocalStorage.disabled = this._options.disableLocalStorage;
    this._overrides = loadOverridesFromLocalStorage();
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
    return this._checkGateImpl(gateName, 'checkGate');
  }

  public checkGateWithExposureLoggingDisabled(gateName: string): boolean {
    return this._checkGateImpl(
      gateName,
      'checkGateWithExposureLoggingDisabled',
    );
  }

  public logGateExposure(gateName: string) {
    this._errorBoundary._swallow('logGateExposure', () => {
      this._logGateExposureImpl(gateName);
    });
  }

  /**
   * Checks the value of a config for the current user
   * @param {string} configName - the name of the config to get
   * @returns {DynamicConfig} - value of a config for the user
   * @throws Error if initialize() is not called first, or configName is not a string
   */
  public getConfig(configName: string): DynamicConfig {
    return this._getConfigImpl(configName, 'getConfig');
  }

  public getConfigWithExposureLoggingDisabled(
    configName: string,
  ): DynamicConfig {
    return this._getConfigImpl(
      configName,
      'getConfigWithExposureLoggingDisabled',
    );
  }

  public logConfigExposure(configName: string) {
    this._errorBoundary._swallow('logConfigExposure', () => {
      this._logConfigExposureImpl(configName);
    });
  }

  public getExperiment(experimentName: string): DynamicConfig {
    return this.getConfig(experimentName);
  }

  public getExperimentWithExposureLoggingDisabled(
    experimentName: string,
  ): DynamicConfig {
    return this.getConfigWithExposureLoggingDisabled(experimentName);
  }

  public logExperimentExposure(experimentName: string) {
    this.logConfigExposure(experimentName);
  }

  public getLayer(layerName: string): Layer {
    return this._getLayerImpl(layerName, 'getLayer');
  }

  public getLayerWithExposureLoggingDisabled(layerName: string): Layer {
    return this._getLayerImpl(layerName, 'getLayerWithExposureLoggingDisabled');
  }

  public logLayerParameterExposure(layerName: string, parameterName: string) {
    this._errorBoundary._swallow('logLayerParameterExposure', () => {
      const layer = this._getLayerFromStore(null, layerName);
      this._logLayerParameterExposureForLayer(layer, parameterName, true);
    });
  }

  public logEvent(
    eventName: string,
    value: string | number | null = null,
    metadata: Record<string, string> | null = null,
  ): void {
    this._errorBoundary._swallow('logEvent', () => {
      if (!this._logger || !this._identity._sdkKey) {
        throw new StatsigUninitializedError(
          StatsigErrorMessage.REQUIRE_INITIALIZE_FOR_LOG_EVENT,
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

  public updateUserWithValues(
    user: StatsigUser | null,
    values: Record<string, unknown>,
  ): boolean {
    const updateStartTime = Date.now();
    let fireCompletionCallback: (
      success: boolean,
      error: string | null,
    ) => void | null;

    return this._errorBoundary._capture(
      'updateUserWithValues',
      () => {
        if (!this.initializeCalled()) {
          throw new StatsigUninitializedError(
            StatsigErrorMessage.REQUIRE_ASYNC_INITIALIZE,
          );
        }

        fireCompletionCallback = (success: boolean, error: string | null) => {
          const cb = this._options.updateUserCompletionCallback;
          cb?.(Date.now() - updateStartTime, success, error);
        };

        this._identity._user = this._normalizeUser(user);
        this._store.bootstrap(values);
        fireCompletionCallback(true, null);
        return true;
      },
      () => {
        fireCompletionCallback?.(
          false,
          'Failed to update user. An unexpected error occured.',
        );
        return false;
      },
    );
  }

  public async updateUser(user: StatsigUser | null): Promise<boolean> {
    const updateStartTime = Date.now();
    let fireCompletionCallback: (
      success: boolean,
      error: string | null,
    ) => void | null;

    return this._errorBoundary._capture(
      'updateUser',
      async () => {
        if (!this.initializeCalled()) {
          throw new StatsigUninitializedError(
            StatsigErrorMessage.REQUIRE_ASYNC_INITIALIZE,
          );
        }

        fireCompletionCallback = (success: boolean, error: string | null) => {
          const cb = this._options.updateUserCompletionCallback;
          cb?.(Date.now() - updateStartTime, success, error);
        };

        this._identity._user = this._normalizeUser(user);
        this._store.updateUser();
        this._logger.resetDedupeKeys();

        if (this._pendingInitPromise != null) {
          await this._pendingInitPromise;
        }

        if (this._options.localMode) {
          fireCompletionCallback(true, null);
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
            fireCompletionCallback(true, null);
            return Promise.resolve(true);
          })
          .catch((error) => {
            fireCompletionCallback(false, `Failed to update user: ${error}`);
            return Promise.resolve(false);
          });
      },
      () => {
        fireCompletionCallback(
          false,
          'Failed to update user. An unexpected error occured.',
        );
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

  public overrideGate(gate: string, result: boolean | null) {
    this._setOverride('gates', gate, result);
  }

  public overrideConfig(
    config: string,
    result: Record<string, unknown> | null,
  ) {
    this._setOverride('configs', config, result);
  }

  public overrideLayer(layer: string, result: Record<string, unknown> | null) {
    this._setOverride('layers', layer, result);
  }

  public setOverrides(overrides: LocalOverrides | null) {
    this._errorBoundary._swallow('setOverrides', () => {
      this._overrides = overrides ?? makeEmptyOverrides();
      saveOverridesToLocalStorage(this._overrides);
    });
  }

  public getOverrides(): LocalOverrides {
    return this._errorBoundary._capture(
      'getOverrides',
      () => this._overrides,
      () => makeEmptyOverrides(),
    );
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
      userCopy = { ...userCopy, statsigEnvironment: this._options.environment };
    }
    return userCopy as StatsigUser;
  }

  private _ensureStoreLoaded(): void {
    if (!this._store.isLoaded()) {
      throw new StatsigUninitializedError();
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
    const previousDerivedFields = this._store.getPreviousDerivedFields(user);

    return this._network
      .fetchValues(user, sinceTime, timeout, previousDerivedFields)
      .eventually((json) => {
        if (!verifySDKKeyUsed(json, this._sdkKey ?? '', this._errorBoundary)) {
          return;
        }
        if (json?.has_updates) {
          this._store.save(user, json, false);
        }
      })
      .then(async (json: Record<string, any>) => {
        return this._errorBoundary._swallow('fetchAndSaveValues', async () => {
          if (
            !verifySDKKeyUsed(json, this._sdkKey ?? '', this._errorBoundary)
          ) {
            return;
          }
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

  private _checkGateImpl(
    gateName: string,
    callsite: 'checkGate' | 'checkGateWithExposureLoggingDisabled',
  ) {
    return this._errorBoundary._capture(
      callsite,
      () => {
        if (typeof this._overrides.gates[gateName] === 'boolean') {
          return this._overrides.gates[gateName];
        }

        const result = this._getGateFromStore(gateName);
        if (callsite === 'checkGate') {
          this._logGateExposureImpl(gateName, result);
        }
        return result.gate.value === true;
      },
      () => false,
    );
  }

  private _getGateFromStore(gateName: string): StoreGateFetchResult {
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
    const result = fetchResult ?? this._getGateFromStore(gateName);
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

  private _getConfigImpl(
    configName: string,
    callsite: 'getConfig' | 'getConfigWithExposureLoggingDisabled',
  ): DynamicConfig {
    return this._errorBoundary._capture(
      callsite,
      () => {
        if (this._overrides.configs[configName]) {
          return new DynamicConfig(
            configName,
            this._overrides.configs[configName],
            'local_override',
            {
              reason: EvaluationReason.LocalOverride,
              time: Date.now(),
            },
          );
        }

        const result = this._getConfigFromStore(configName);
        if (callsite === 'getConfig') {
          this._logConfigExposureImpl(configName, result);
        }
        return result;
      },
      () => this._getEmptyConfig(configName),
    );
  }

  private _getConfigFromStore(configName: string): DynamicConfig {
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
    const localConfig = config ?? this._getConfigFromStore(configName);

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
    layerName: string,
    callsite: 'getLayer' | 'getLayerWithExposureLoggingDisabled',
  ) {
    return this._errorBoundary._capture(
      callsite,
      () => {
        if (this._overrides.layers[layerName]) {
          return Layer._create(
            layerName,
            this._overrides.layers[layerName],
            'local_override',
            {
              reason: EvaluationReason.LocalOverride,
              time: Date.now(),
            },
          );
        }

        const logFunc =
          callsite === 'getLayer'
            ? this._logLayerParameterExposureForLayer
            : null;
        return this._getLayerFromStore(logFunc, layerName);
      },
      () =>
        Layer._create(layerName, {}, '', this._getEvaluationDetailsForError()),
    );
  }

  private _getLayerFromStore(
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

  private _setOverride(
    type: 'gates' | 'configs' | 'layers',
    key: string,
    result: unknown | null,
  ) {
    if (result == null) {
      delete this._overrides[type][key];
    } else {
      this._overrides[type][key] = result as any;
    }

    this.setOverrides(this._overrides);
  }
}
