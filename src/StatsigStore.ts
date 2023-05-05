import DynamicConfig, { OnDefaultValueFallback } from './DynamicConfig';
import Layer, { LogParameterFunction } from './Layer';
import { IHasStatsigInternal } from './StatsigClient';
import BootstrapValidator from './utils/BootstrapValidator';
import { StatsigUser } from './StatsigUser';
import {
  INTERNAL_STORE_KEY,
} from './utils/Constants';
import { getHashValue, getUserCacheKey } from './utils/Hashing';
import StatsigLocalStorage from './utils/StatsigLocalStorage';

export enum EvaluationReason {
  Network = 'Network',
  Bootstrap = 'Bootstrap',
  InvalidBootstrap = 'InvalidBootstrap',
  Cache = 'Cache',
  Prefetch = 'Prefetch',
  LocalOverride = 'LocalOverride',
  Unrecognized = 'Unrecognized',
  Uninitialized = 'Uninitialized',
  Error = 'Error',
  NetworkNotModified = 'NetworkNotModified',
}

export type EvaluationDetails = {
  time: number;
  reason: EvaluationReason;
};

type APIFeatureGate = {
  name: string;
  value: boolean;
  rule_id: string;
  secondary_exposures: [];
};

export type StoreGateFetchResult = {
  gate: APIFeatureGate;
  evaluationDetails: EvaluationDetails;
};

type APIDynamicConfig = {
  name: string;
  value: { [key: string]: unknown };
  rule_id: string;
  secondary_exposures: [];
  is_device_based?: boolean;
  is_user_in_experiment?: boolean;
  is_experiment_active?: boolean;
  allocated_experiment_name: string | null;
  undelegated_secondary_exposures?: [];
  explicit_parameters?: string[];
};

type APIInitializeData = {
  dynamic_configs: Record<string, APIDynamicConfig | undefined>;
  feature_gates: Record<string, APIFeatureGate | undefined>;
  layer_configs: Record<string, APIDynamicConfig | undefined>;
  has_updates?: boolean;
  time: number;
  user_hash?: string;
};

type APIInitializeDataWithDeltas = APIInitializeData & {
  deleted_configs?: string[];
  deleted_gates?: string[];
  deleted_layers?: string[];
  is_delta?: boolean;
};

type APIInitializeDataWithPrefetchedUsers = APIInitializeData & {
  prefetched_user_values?: Record<string, APIInitializeData>;
};

type APIInitializeDataWithDeltasWithPrefetchedUsers =
  APIInitializeDataWithDeltas & {
    prefetched_user_values?: Record<string, APIInitializeDataWithDeltas>;
  };

type UserCacheValues = APIInitializeDataWithPrefetchedUsers & {
  evaluation_time?: number;
};

const MAX_USER_VALUE_CACHED = 10;

export default class StatsigStore {
  private sdkInternal: IHasStatsigInternal;

  private loaded: boolean;
  private values: Record<string, UserCacheValues | undefined>;
  private userValues: UserCacheValues;
  private userCacheKey: string;
  private reason: EvaluationReason;

  public constructor(
    sdkInternal: IHasStatsigInternal,
    initializeValues: Record<string, any> | null,
  ) {
    this.sdkInternal = sdkInternal;
    this.userCacheKey = this.sdkInternal.getCurrentUserCacheKey();
    this.values = {};
    this.userValues = {
      feature_gates: {},
      dynamic_configs: {},
      layer_configs: {},
      has_updates: false,
      time: 0,
      evaluation_time: 0,
    };
    this.loaded = false;
    this.reason = EvaluationReason.Uninitialized;
    if (initializeValues) {
      this.bootstrap(initializeValues);
    } else {
      this.loadFromLocalStorage();
    }
  }

  public updateUser(isUserPrefetched: boolean): number | null {
    this.userCacheKey = this.sdkInternal.getCurrentUserCacheKey();
    return this.setUserValueFromCache(isUserPrefetched);
  }

  public bootstrap(initializeValues: Record<string, any>): void {
    const key = this.sdkInternal.getCurrentUserCacheKey();
    const user = this.sdkInternal.getCurrentUser();

    const reason = BootstrapValidator.isValid(user, initializeValues)
      ? EvaluationReason.Bootstrap
      : EvaluationReason.InvalidBootstrap;

    // clients are going to assume that the SDK is bootstraped after this method runs
    // if we fail to parse, we will fall back to defaults, but we dont want to throw
    // when clients try to check gates/configs/etc after this point
    this.loaded = true;
    try {
      this.userValues.feature_gates = initializeValues.feature_gates ?? {};
      this.userValues.dynamic_configs = initializeValues.dynamic_configs ?? {};
      this.userValues.layer_configs = initializeValues.layer_configs ?? {};
      this.userValues.evaluation_time = Date.now();
      this.userValues.time = Date.now();
      this.values[key] = this.userValues;
      this.reason = reason;
    } catch (_e) {
      return;
    }
  }

  private loadFromLocalStorage(): void {
    this.parseCachedValues(
      StatsigLocalStorage.getItem(INTERNAL_STORE_KEY),
    );
    this.loaded = true;
  }

  public isLoaded(): boolean {
    return this.loaded;
  }

  public getLastUpdateTime(user: StatsigUser | null): number | null {
    const userHash = getHashValue(JSON.stringify(user));
    if (this.userValues.user_hash == userHash) {
      return this.userValues.time;
    }
    return null;
  }

  private parseCachedValues(
    allValues: string | null,
  ): void {
    try {
      this.values = allValues ? JSON.parse(allValues) : this.values;
      this.setUserValueFromCache();
    } catch (e) {
      // Cached value corrupted, remove cache
      this.removeFromStorage(INTERNAL_STORE_KEY);
    }
  }

  private setUserValueFromCache(
    isUserPrefetched: boolean = false,
  ): number | null {
    let cachedValues = this.values[this.userCacheKey];
    if (cachedValues == null) {
      this.resetUserValues();
      this.reason = EvaluationReason.Uninitialized;
      return null;
    }

    this.userValues = cachedValues;
    this.reason = isUserPrefetched
      ? EvaluationReason.Prefetch
      : EvaluationReason.Cache;

    return cachedValues.evaluation_time ?? 0;
  }

  private removeFromStorage(key: string) {
    StatsigLocalStorage.removeItem(key);
  }

  public setEvaluationReason(evalReason: EvaluationReason) {
    this.reason = evalReason;
  }

  public async save(
    user: StatsigUser | null,
    jsonConfigs: Record<string, any>,
    updateState: boolean = true,
  ): Promise<void> {
    const requestedUserCacheKey = getUserCacheKey(user);
    const initResponse = jsonConfigs as APIInitializeData;

    this.mergeInitializeResponseIntoUserMap(
      initResponse,
      this.values,
      requestedUserCacheKey,
      user,
      (userValues) => userValues,
    );

    if (updateState) {
      const userValues = this.values[requestedUserCacheKey];
      if (
        userValues &&
        requestedUserCacheKey &&
        requestedUserCacheKey == this.userCacheKey
      ) {
        this.userValues = userValues;
        this.reason = EvaluationReason.Network;
      }
    }

    this.values = await this.writeValuesToStorage(this.values);
  }

  /**
   * Merges the provided init configs into the provided config map, according to the provided merge function
   */
  private mergeInitializeResponseIntoUserMap(
    data: APIInitializeDataWithPrefetchedUsers,
    configMap: Record<string, UserCacheValues | undefined>,
    requestedUserCacheKey: string,
    user: StatsigUser | null,
    mergeFn: (user: UserCacheValues, key: string) => UserCacheValues,
  ) {
    if (data.prefetched_user_values) {
      const cacheKeys = Object.keys(data.prefetched_user_values);
      for (const key of cacheKeys) {
        const prefetched = data.prefetched_user_values[key];
        configMap[key] = mergeFn(
          this.convertAPIDataToCacheValues(prefetched, key),
          key,
        );
      }
    }

    if (requestedUserCacheKey) {
      const requestedUserValues = this.convertAPIDataToCacheValues(
        data,
        requestedUserCacheKey,
      );
      if (data.has_updates && data.time) {
        const userHash = getHashValue(JSON.stringify(user));
        requestedUserValues.user_hash = userHash;
      }

      configMap[requestedUserCacheKey] = mergeFn(
        requestedUserValues,
        requestedUserCacheKey,
      );
    }
  }

  private getDefaultUserCacheValues(): UserCacheValues {
    return {
      feature_gates: {},
      layer_configs: {},
      dynamic_configs: {},
      time: 0,
      evaluation_time: 0,
    };
  }

  private mergeUserCacheValues(
    baseValues: UserCacheValues,
    valuesToMerge: UserCacheValues,
  ): UserCacheValues {
    return {
      feature_gates: {
        ...baseValues.feature_gates,
        ...valuesToMerge.feature_gates,
      },
      layer_configs: {
        ...baseValues.layer_configs,
        ...valuesToMerge.layer_configs,
      },
      dynamic_configs: {
        ...baseValues.dynamic_configs,
        ...valuesToMerge.dynamic_configs,
      },
      time: valuesToMerge.time,
      evaluation_time: valuesToMerge.evaluation_time,
    };
  }

  /**
   * Writes the provided values to storage, truncating down to
   * MAX_USER_VALUE_CACHED number entries.
   * @returns The truncated entry list
   */
  private async writeValuesToStorage(
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

  public checkGate(
    gateName: string,
    ignoreOverrides: boolean = false,
  ): StoreGateFetchResult {
    const gateNameHash = getHashValue(gateName);
    let gateValue: APIFeatureGate = {
      name: gateName,
      value: false,
      rule_id: '',
      secondary_exposures: [],
    };
    let details: EvaluationDetails;
    let value = this.userValues?.feature_gates[gateNameHash];
      if (value) {
        gateValue = value;
      }
      details = this.getEvaluationDetails(value != null);

    return { evaluationDetails: details, gate: gateValue };
  }

  public getConfig(
    configName: string,
  ): DynamicConfig {
    const configNameHash = getHashValue(configName);
    let configValue: DynamicConfig;
    let details: EvaluationDetails;
    if (this.userValues?.dynamic_configs[configNameHash] != null) {
      const rawConfigValue = this.userValues?.dynamic_configs[configNameHash];
      details = this.getEvaluationDetails(true);
      configValue = this.createDynamicConfig(
        configName,
        rawConfigValue,
        details,
      );
    } else {
      details = this.getEvaluationDetails(false);
      configValue = new DynamicConfig(configName, {}, '', details);
    }

    return configValue;
  }

  public getLayer(
    logParameterFunction: LogParameterFunction | null,
    layerName: string,
  ): Layer {
    const latestValue = this.getLatestValue(layerName, 'layer_configs');
    const details = this.getEvaluationDetails(latestValue != null);

    return Layer._create(
      layerName,
      latestValue?.value ?? {},
      latestValue?.rule_id ?? '',
      details,
      logParameterFunction,
      latestValue?.secondary_exposures,
      latestValue?.undelegated_secondary_exposures,
      latestValue?.allocated_experiment_name ?? '',
      latestValue?.explicit_parameters,
    );
  }


  private getLatestValue(
    name: string,
    topLevelKey: 'layer_configs' | 'dynamic_configs',
  ): APIDynamicConfig | undefined {
    const hash = getHashValue(name);
    return (
      this.userValues?.[topLevelKey]?.[hash] ??
      this.userValues?.[topLevelKey]?.[name]
    );
  }

  private createDynamicConfig(
    name: string,
    apiConfig: APIDynamicConfig | undefined,
    details: EvaluationDetails,
  ) {
    return new DynamicConfig(
      name,
      apiConfig?.value ?? {},
      apiConfig?.rule_id ?? '',
      details,
      apiConfig?.secondary_exposures,
      apiConfig?.allocated_experiment_name ?? '',
      this.makeOnConfigDefaultValueFallback(this.sdkInternal.getCurrentUser()),
    );
  }

  public getGlobalEvaluationDetails(): EvaluationDetails {
    return {
      reason: this.reason ?? EvaluationReason.Uninitialized,
      time: this.userValues.evaluation_time ?? 0,
    };
  }

  private getEvaluationDetails(
    valueExists: Boolean,
    reasonOverride?: EvaluationReason,
  ): EvaluationDetails {
    if (valueExists) {
      return {
        reason: this.reason,
        time: this.userValues.evaluation_time ?? Date.now(),
      };
    } else {
      return {
        reason:
          reasonOverride ??
          (this.reason == EvaluationReason.Uninitialized
            ? EvaluationReason.Uninitialized
            : EvaluationReason.Unrecognized),
        time: Date.now(),
      };
    }
  }

  private resetUserValues() {
    this.userValues = {
      feature_gates: {},
      dynamic_configs: {},
      layer_configs: {},
      time: 0,
      evaluation_time: 0,
    };
  }

  private convertAPIDataToCacheValues(
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
    };
  }

  private setItemToStorage(key: string, value: string) {
    StatsigLocalStorage.setItem(key, value);
  }

  private makeOnConfigDefaultValueFallback(
    user: StatsigUser | null,
  ): OnDefaultValueFallback {
    return (config, parameter, defaultValueType, valueType) => {
      if (!this.isLoaded()) {
        return;
      }

      this.sdkInternal.getLogger().logConfigDefaultValueFallback(
        user,
        `Parameter ${parameter} is a value of type ${valueType}.
          Returning requested defaultValue type ${defaultValueType}`,
        {
          name: config.getName(),
          ruleID: config.getRuleID(),
          parameter,
          defaultValueType,
          valueType,
        },
      );
    };
  }
}
