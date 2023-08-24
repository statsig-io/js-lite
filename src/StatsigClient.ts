import DynamicConfig, { OnDefaultValueFallback } from './DynamicConfig';
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
import {
  EvaluationDetails,
  EvaluationReason,
} from './EvaluationMetadata';
import StatsigStore from './StatsigStore';
import { StatsigUser } from './StatsigUser';
import StatsigLocalStorage from './utils/StatsigLocalStorage';
import { now } from './utils/Timing';
import makeLogEvent from './LogEvent';
import ConfigEvaluation from './ConfigEvaluation';

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
      (typeof sdkKey !== 'string')
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
    );

    this._errorBoundary._setStatsigMetadata(this._identity._statsigMetadata);

    if (this._options.initializeValues != null) {
      this._ready = true;
      this._initCalled = true;

      setTimeout(() => this._delayedSetup(), 20);
    }
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

    return this._network
      .fetchValues(user, sinceTime, timeout)
      .eventually((json) => {
        if (json?.has_updates) {
          this._store.save(user, json);
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

  private _checkGateImpl(
    gateName: string,
    callsite: 'checkGate' | 'checkGateWithExposureLoggingDisabled',
  ) {
    return this._errorBoundary._capture(
      callsite,
      () => {
        const result = this._getGateFromStore(gateName);
        if (callsite === 'checkGate') {
          this._logGateExposureImpl(gateName, result);
        }
        return result.value === true;
      },
      () => false,
    );
  }

  private _getGateFromStore(gateName: string): ConfigEvaluation {
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
    fetchResult?: ConfigEvaluation,
  ) {
    const isManualExposure = !fetchResult;
    const result = fetchResult ?? this._getGateFromStore(gateName);

    this._logger.logGateExposure(
      this._identity._user,
      gateName,
      result.value,
      result.rule_id,
      result.secondary_exposures,
      result.evaluation_details,
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
    const evaluation = this._store.getConfig(configName);
    return new DynamicConfig(
      configName,
      evaluation.json_value,
      evaluation.rule_id,
      evaluation.evaluation_details,
      evaluation.secondary_exposures,
      undefined,
      this._makeOnConfigDefaultValueFallback(this._identity._user),
    );
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

  private _makeOnConfigDefaultValueFallback(
    user: StatsigUser | null,
  ): OnDefaultValueFallback {
    return (config, parameter, defaultValueType, valueType) => {
      if (!this._initCalled) {
        return;
      }

      this._logger.logConfigDefaultValueFallback(
        user,
        `Parameter ${parameter} is a value of type ${valueType}.
          Returning requested defaultValue type ${defaultValueType}`,
        {
          name: config._name,
          ruleID: config._ruleID,
          parameter,
          defaultValueType,
          valueType,
        },
      );
    };
  }

  private _getLayerImpl(
    layerName: string,
    callsite: 'getLayer' | 'getLayerWithExposureLoggingDisabled',
  ) {
    return this._errorBoundary._capture(
      callsite,
      () => {
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
    // TODO @tore
    return Layer._create(layerName, {}, '', { reason: EvaluationReason.Unrecognized, time: Date.now() });//this._store.getLayer(logParameterFunction, layerName);
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
