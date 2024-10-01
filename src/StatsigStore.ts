import DynamicConfig, { OnDefaultValueFallback } from './DynamicConfig';
import Layer, { LogParameterFunction } from './Layer';
import StatsigIdentity from './StatsigIdentity';
import { StatsigUser } from './StatsigUser';
import BootstrapValidator from './utils/BootstrapValidator';
import { INTERNAL_STORE_KEY } from './utils/Constants';
import {
  djb2HashForObject,
  getHashValue,
  getUserCacheKey,
} from './utils/Hashing';
import StatsigLocalStorage from './utils/StatsigLocalStorage';

export enum EvaluationReason {
  Network = 'Network',
  Bootstrap = 'Bootstrap',
  InvalidBootstrap = 'InvalidBootstrap',
  Cache = 'Cache',
  Unrecognized = 'Unrecognized',
  Uninitialized = 'Uninitialized',
  Error = 'Error',
  NetworkNotModified = 'NetworkNotModified',
  LocalOverride = 'LocalOverride',
}

export type EvaluationDetails = {
  time: number;
  reason: EvaluationReason;
};

type APIFeatureGate = {
  name: string;
  value: boolean;
  rule_id: string;
  secondary_exposures?: number[] | Record<string, string>[];
};

export type StoreGateFetchResult = {
  gate: APIFeatureGate;
  evaluationDetails: EvaluationDetails;
};

type APIDynamicConfig = {
  name: string;
  value: { [key: string]: unknown };
  rule_id: string;
  secondary_exposures?: number[] | Record<string, string>[];
  is_user_in_experiment?: boolean;
  is_experiment_active?: boolean;
  allocated_experiment_name: string | null;
  undelegated_secondary_exposures?: number[] | Record<string, string>[];
  explicit_parameters?: string[];
};

type APIInitializeData = {
  dynamic_configs: Record<string, APIDynamicConfig | undefined>;
  feature_gates: Record<string, APIFeatureGate | undefined>;
  layer_configs: Record<string, APIDynamicConfig | undefined>;
  has_updates?: boolean;
  time: number;
  user_hash?: string;
  derived_fields?: Record<string, string>;
  hash_used?: string;
  exposures?: Record<string, string>[];
};

type UserCacheValues = APIInitializeData & {
  evaluation_time?: number;
  bootstrapMetadata?: BootstrapMetadata;
};

export type BootstrapMetadata = {
  generatorSDKInfo?: Record<string, string>;
  lcut?: number;
  user?: Record<string, unknown>;
};

const MAX_USER_VALUE_CACHED = 10;

type DefaultValueFallbackFunc = (
  user: StatsigUser | null,
  message: string,
  metadata: object,
) => void;

export default class StatsigStore {
  private _identity: StatsigIdentity;
  private _loaded: boolean;
  private _values: Record<string, UserCacheValues | undefined>;
  private _userValues: UserCacheValues;
  private _userCacheKey: string;
  private _reason: EvaluationReason;

  private readonly _onDefaultValueFallback: DefaultValueFallbackFunc;

  constructor(
    identity: StatsigIdentity,
    onDefaultValueFallback: DefaultValueFallbackFunc,
    initializeValues: Record<string, any> | null,
  ) {
    this._identity = identity;
    this._onDefaultValueFallback = onDefaultValueFallback;
    this._userCacheKey = this._identity.getUserCacheKey();
    this._values = {};
    this._userValues = this._getDefaultUserCacheValues();
    this._loaded = false;
    this._reason = EvaluationReason.Uninitialized;

    if (initializeValues) {
      this.bootstrap(initializeValues);
    } else {
      this._loadFromLocalStorage();
    }
  }

  public updateUser(): number | null {
    this._userCacheKey = this._identity.getUserCacheKey();
    return this._setUserValueFromCache();
  }

  public bootstrap(initializeValues: Record<string, any>): void {
    const key = this._identity.getUserCacheKey();
    const user = this._identity._user;

    const reason = BootstrapValidator.isValid(user, initializeValues)
      ? EvaluationReason.Bootstrap
      : EvaluationReason.InvalidBootstrap;

    // clients are going to assume that the SDK is bootstrapped after this method runs
    // if we fail to parse, we will fall back to defaults, but we dont want to throw
    // when clients try to check gates/configs/etc after this point
    this._loaded = true;
    try {
      this._userValues.feature_gates = initializeValues.feature_gates ?? {};
      this._userValues.dynamic_configs = initializeValues.dynamic_configs ?? {};
      this._userValues.layer_configs = initializeValues.layer_configs ?? {};
      this._userValues.evaluation_time = Date.now();
      this._userValues.time = initializeValues.time ?? Date.now();
      this._userValues.exposures = initializeValues.exposures ?? [];
      this._userValues.hash_used = initializeValues.hash_used ?? 'djb2';
      this._values[key] = this._userValues;
      this._reason = reason;
      const generatorSDKInfo =
        (initializeValues.sdkInfo as Record<string, string> | undefined) ??
        (initializeValues.sdk_info as Record<string, string> | undefined);
      this._userValues.bootstrapMetadata = {};
      if (generatorSDKInfo != null) {
        this._userValues.bootstrapMetadata.generatorSDKInfo = generatorSDKInfo;
      }
      if (initializeValues.user != null) {
        this._userValues.bootstrapMetadata.user =
          initializeValues.user as Record<string, unknown>;
      }
      if (initializeValues.time != null) {
        this._userValues.bootstrapMetadata.lcut =
          initializeValues.time as number;
      }
    } catch (_e) {
      return;
    }
  }

  public getBootstrapMetadata(): BootstrapMetadata | null {
    return this._userValues.bootstrapMetadata ?? null;
  }

  public isLoaded(): boolean {
    return this._loaded;
  }

  public getLastUpdateTime(user: StatsigUser | null): number | null {
    const userHash = djb2HashForObject(user);
    if (this._userValues.user_hash == userHash) {
      return this._userValues.time;
    }
    return null;
  }

  public getPreviousDerivedFields(
    user: StatsigUser | null,
  ): Record<string, string> | undefined {
    const userHash = djb2HashForObject(user);
    if (this._userValues.user_hash == userHash) {
      return this._userValues.derived_fields;
    }
    return undefined;
  }

  public setEvaluationReason(evalReason: EvaluationReason) {
    this._reason = evalReason;
  }

  public async save(
    user: StatsigUser | null,
    jsonConfigs: Record<string, any>,
    updateState: boolean = true,
  ): Promise<void> {
    const requestedUserCacheKey = getUserCacheKey(user);
    const initResponse = jsonConfigs as APIInitializeData;

    this._mergeInitializeResponseIntoUserMap(
      initResponse,
      this._values,
      requestedUserCacheKey,
      user,
      (userValues) => userValues,
    );

    if (updateState) {
      const userValues = this._values[requestedUserCacheKey];
      if (
        userValues &&
        requestedUserCacheKey &&
        requestedUserCacheKey == this._userCacheKey
      ) {
        this._userValues = userValues;
        this._reason = EvaluationReason.Network;
      }
    }

    this._values = await this._writeValuesToStorage(this._values);
  }

  public checkGate(gateName: string): StoreGateFetchResult {
    const gateNameHash = getHashValue(gateName, this._userValues.hash_used);
    let gateValue: APIFeatureGate = {
      name: gateName,
      value: false,
      rule_id: '',
      secondary_exposures: [],
    };
    let details: EvaluationDetails;
    let value = this._userValues?.feature_gates[gateNameHash];
    if (value) {
      gateValue = value;
    }
    gateValue.secondary_exposures = this.mapExposures(
      gateValue.secondary_exposures ?? [],
    );
    details = this._getEvaluationDetails(value != null);

    return { evaluationDetails: details, gate: gateValue };
  }

  public mapExposures(
    exposures: Record<string, string>[] | number[],
  ): Record<string, string>[] {
    return exposures.map((exposure) => {
      if (typeof exposure === 'number') {
        return (this._userValues.exposures ?? [])[exposure];
      }
      return exposure;
    });
  }

  public getConfig(configName: string): DynamicConfig {
    const configNameHash = getHashValue(configName, this._userValues.hash_used);
    let configValue: DynamicConfig;
    let details: EvaluationDetails;
    if (this._userValues?.dynamic_configs[configNameHash] != null) {
      const rawConfigValue = this._userValues?.dynamic_configs[configNameHash];
      details = this._getEvaluationDetails(true);
      configValue = this._createDynamicConfig(
        configName,
        rawConfigValue,
        details,
      );
    } else {
      details = this._getEvaluationDetails(false);
      configValue = new DynamicConfig(configName, {}, '', details);
    }

    return configValue;
  }

  public getLayer(
    logParameterFunction: LogParameterFunction | null,
    layerName: string,
  ): Layer {
    const latestValue = this._getLatestValue(layerName, 'layer_configs');
    const details = this._getEvaluationDetails(latestValue != null);

    return Layer._create(
      layerName,
      latestValue?.value ?? {},
      latestValue?.rule_id ?? '',
      details,
      logParameterFunction,
      this.mapExposures(latestValue?.secondary_exposures ?? []),
      this.mapExposures(latestValue?.undelegated_secondary_exposures ?? []),
      latestValue?.allocated_experiment_name ?? '',
      latestValue?.explicit_parameters,
    );
  }

  public getGlobalEvaluationDetails(): EvaluationDetails {
    return {
      reason: this._reason ?? EvaluationReason.Uninitialized,
      time: this._userValues.evaluation_time ?? 0,
    };
  }

  private _loadFromLocalStorage(): void {
    this._parseCachedValues(StatsigLocalStorage.getItem(INTERNAL_STORE_KEY));
    this._loaded = true;
  }

  private _parseCachedValues(allValues: string | null): void {
    try {
      this._values = allValues ? JSON.parse(allValues) : this._values;
      this._setUserValueFromCache();
    } catch (e) {
      // Cached value corrupted, remove cache
      this._removeFromStorage(INTERNAL_STORE_KEY);
    }
  }

  private _setUserValueFromCache(): number | null {
    let cachedValues = this._values[this._userCacheKey];
    if (cachedValues == null) {
      this._resetUserValues();
      this._reason = EvaluationReason.Uninitialized;
      return null;
    }

    this._userValues = cachedValues;
    this._reason = EvaluationReason.Cache;

    return cachedValues.evaluation_time ?? 0;
  }

  private _removeFromStorage(key: string) {
    StatsigLocalStorage.removeItem(key);
  }

  /**
   * Merges the provided init configs into the provided config map, according to the provided merge function
   */
  private _mergeInitializeResponseIntoUserMap(
    data: APIInitializeData,
    configMap: Record<string, UserCacheValues | undefined>,
    requestedUserCacheKey: string,
    user: StatsigUser | null,
    mergeFn: (user: UserCacheValues, key: string) => UserCacheValues,
  ) {
    if (requestedUserCacheKey) {
      const requestedUserValues = this._convertAPIDataToCacheValues(
        data,
        requestedUserCacheKey,
      );
      if (data.has_updates && data.time) {
        const userHash = djb2HashForObject(user);
        requestedUserValues.user_hash = userHash;
      }

      configMap[requestedUserCacheKey] = mergeFn(
        requestedUserValues,
        requestedUserCacheKey,
      );
    }
  }

  private _getDefaultUserCacheValues(): UserCacheValues {
    return {
      feature_gates: {},
      layer_configs: {},
      dynamic_configs: {},
      time: 0,
      evaluation_time: 0,
      has_updates: false,
    };
  }

  /**
   * Writes the provided values to storage, truncating down to
   * MAX_USER_VALUE_CACHED number entries.
   * @returns The truncated entry list
   */
  private async _writeValuesToStorage(
    valuesToWrite: Record<string, UserCacheValues | undefined>,
  ): Promise<Record<string, UserCacheValues | undefined>> {
    // trim values to only have the max allowed
    const filteredValues = Object.entries(valuesToWrite)
      .sort(({ 1: a }, { 1: b }) => {
        if (a == null) {
          return 1;
        }
        if (b == null) {
          return -1;
        }
        return (
          (b?.evaluation_time ?? b?.time) - (a?.evaluation_time ?? a?.time)
        );
      })
      .slice(0, MAX_USER_VALUE_CACHED);
    valuesToWrite = Object.fromEntries(filteredValues);
    StatsigLocalStorage.setItem(
      INTERNAL_STORE_KEY,
      JSON.stringify(valuesToWrite),
    );

    return valuesToWrite;
  }

  private _getLatestValue(
    name: string,
    topLevelKey: 'layer_configs' | 'dynamic_configs',
  ): APIDynamicConfig | undefined {
    const hash = getHashValue(name, this._userValues.hash_used);
    return (
      this._userValues?.[topLevelKey]?.[hash] ??
      this._userValues?.[topLevelKey]?.[name]
    );
  }

  private _createDynamicConfig(
    name: string,
    apiConfig: APIDynamicConfig | undefined,
    details: EvaluationDetails,
  ) {
    return new DynamicConfig(
      name,
      apiConfig?.value ?? {},
      apiConfig?.rule_id ?? '',
      details,
      this.mapExposures(apiConfig?.secondary_exposures ?? []),
      apiConfig?.allocated_experiment_name ?? '',
      this._makeOnConfigDefaultValueFallback(this._identity._user),
    );
  }

  private _getEvaluationDetails(
    valueExists: Boolean,
    reasonOverride?: EvaluationReason,
  ): EvaluationDetails {
    if (valueExists) {
      return {
        reason: this._reason,
        time: this._userValues.evaluation_time ?? Date.now(),
      };
    } else {
      return {
        reason:
          reasonOverride ??
          (this._reason == EvaluationReason.Uninitialized
            ? EvaluationReason.Uninitialized
            : EvaluationReason.Unrecognized),
        time: Date.now(),
      };
    }
  }

  private _resetUserValues() {
    this._userValues = this._getDefaultUserCacheValues();
  }

  private _convertAPIDataToCacheValues(
    data: APIInitializeData,
    cacheKey: string,
  ): UserCacheValues {
    // Specifically pulling keys from data here to avoid pulling in unwanted keys
    return {
      feature_gates: data.feature_gates,
      layer_configs: data.layer_configs,
      dynamic_configs: data.dynamic_configs,
      time: data.time == null || isNaN(data.time) ? 0 : data.time,
      evaluation_time: Date.now(),
      derived_fields: data.derived_fields,
      hash_used: data.hash_used,
    };
  }

  private _makeOnConfigDefaultValueFallback(
    user: StatsigUser | null,
  ): OnDefaultValueFallback {
    return (config, parameter, defaultValueType, valueType) => {
      if (!this.isLoaded()) {
        return;
      }

      this._onDefaultValueFallback(
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
}
