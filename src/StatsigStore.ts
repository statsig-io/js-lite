import { StatsigUser } from './StatsigUser';
import StatsigIdentity from './StatsigIdentity';
import type {
  EvaluationDetails,
} from './EvaluationMetadata';
import {
  EvaluationReason,
} from './EvaluationMetadata';
import Identity from './StatsigIdentity';
import StatsigSDKOptions from './StatsigSDKOptions';
import { ConfigSpec } from './ConfigSpec';
export default class StatsigStore {

  private loaded: boolean;
  private lcut: number;
  private reason: EvaluationReason;
  private identity: Identity;

  private featureGates: Record<string, ConfigSpec>;
  private dynamicConfigs: Record<string, ConfigSpec>;
  private layerConfigs: Record<string, ConfigSpec>;
  private options: StatsigSDKOptions;

  public constructor(
    options: StatsigSDKOptions,
    identity: StatsigIdentity,
  ) {
    this.identity = identity;
    this.options = options;
    this.lcut = 0;
    this.loaded = false;
    this.reason = EvaluationReason.Uninitialized;
    this.loadFromLocalStorage();

    this.featureGates = {};
    this.dynamicConfigs = {};
    this.layerConfigs = {};
  }

  public setInitializeValues(initializeValues: Record<string, unknown>): void {
    this.setConfigSpecs(initializeValues);
    this.reason = EvaluationReason.Bootstrap;
  }

  // TODO-HACK @tore
  private loadFromLocalStorage(): void {
    // TODO-HACK @tore
  }

  public getLastUpdateTime(user: StatsigUser): number | null {
    return this.lcut;
  }

  public setEvaluationReason(evalReason: EvaluationReason) {
    this.reason = evalReason;
  }

  public async save(
    jsonConfigs: Record<string, any>,
  ): Promise<void> {
    const updated = this.setConfigSpecs(jsonConfigs);
    if (updated) {
      this.lcut = jsonConfigs.time ?? 0;
    }
    this.reason = EvaluationReason.Network;
  }

  public setConfigSpecs(values: Record<string, unknown>) {
    let updatedGates: Record<string, ConfigSpec> = {};
    let updatedConfigs: Record<string, ConfigSpec> = {};
    let updatedLayers: Record<string, ConfigSpec> = {};
    const featureGates = values.feature_gates;
    const dynamicConfigs = values.dynamic_configs;
    const layerConfigs = values.layer_configs;
    
    if (
      !Array.isArray(featureGates) ||
      !Array.isArray(dynamicConfigs) ||
      !Array.isArray(layerConfigs)
    ) {
      return false;
    }

    for (const gateJSON of featureGates) {
      try {
        const gate = new ConfigSpec(gateJSON);
        updatedGates[gate.name] = gate;
      } catch (e) {
        return false;
      }
    }

    for (const configJSON of dynamicConfigs) {
      try {
        const config = new ConfigSpec(configJSON);
        updatedConfigs[config.name] = config;
      } catch (e) {
        return false;
      }
    }

    for (const layerJSON of layerConfigs) {
      try {
        const config = new ConfigSpec(layerJSON);
        updatedLayers[config.name] = config;
      } catch (e) {
        console.error(e);
        return false;
      }
    }

    this.featureGates = updatedGates;
    this.dynamicConfigs = updatedConfigs;
    this.layerConfigs = updatedLayers;

    return true;
  }

  public getDynamicConfig(configName: string): ConfigSpec | null {
    return this.dynamicConfigs[configName] ?? null;
  }

  public getFeatureGate(gateName: string): ConfigSpec | null {
    return this.featureGates[gateName] ?? null;
  }

  public getLayerConfig(layerName: string): ConfigSpec | null {
    return this.layerConfigs[layerName] ?? null;
  }

  public getGlobalEvaluationDetails(): EvaluationDetails {
    return {
      reason: this.reason ?? EvaluationReason.Uninitialized,
      time: this.lcut ?? 0,
    };
  }

  private getEvaluationDetails(
    valueExists: Boolean,
    reasonOverride?: EvaluationReason,
  ): EvaluationDetails {
    if (valueExists) {
      return {
        reason: this.reason,
        time: this.lcut ?? Date.now(),
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
}
