import { StatsigUser } from './StatsigUser';
import StatsigIdentity from './StatsigIdentity';
import Evaluator from './Evaluator';
import ConfigEvaluation from './ConfigEvaluation';
import type {
  EvaluationDetails,
} from './EvaluationMetadata';
import {
  EvaluationReason,
} from './EvaluationMetadata';
import Identity from './StatsigIdentity';

export default class StatsigStore {

  private loaded: boolean;
  private lcut: number;
  private reason: EvaluationReason;
  private evaluator: Evaluator;
  private identity: Identity;

  public constructor(
    identity: StatsigIdentity,
  ) {
    this.identity = identity;
    this.lcut = 0;
    this.loaded = false;
    this.reason = EvaluationReason.Uninitialized;
    this.evaluator = new Evaluator();
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage(): void {
    // TODO-HACK @tore
    this.loaded = true;
  }

  public isLoaded(): boolean {
    return this.loaded;
  }

  public getLastUpdateTime(user: StatsigUser | null): number | null {
    return this.lcut;
  }

  private parseCachedValues(
    allValues: string | null,
    deviceExperiments: string | null,
  ): void {
    // TODO-HACK @tore

  }

  private setUserValueFromCache(
    isUserPrefetched: boolean = false,
  ): number | null {
    // TODO-HACK @tore
    return null;
  }

  public setEvaluationReason(evalReason: EvaluationReason) {
    this.reason = evalReason;
  }

  public async save(
    jsonConfigs: Record<string, any>,
  ): Promise<void> {
    const featureGates = jsonConfigs.feature_gates as Array<Record<string, unknown>>;
    const dynamicConfigs = jsonConfigs.dynamic_configs as Array<Record<string, unknown>>;
    const layerConfigs = jsonConfigs.layer_configs as Array<Record<string, unknown>>;
    const layerMapping = jsonConfigs.layer_configs as Record<string, Array<String>>;

    const updated = this.evaluator.setConfigSpecs(
      featureGates,
      dynamicConfigs,
      layerConfigs,
      layerMapping,
    );
    if (updated) {
      this.lcut = jsonConfigs.time ?? 0;
    }
  }

  public checkGate(
    user: StatsigUser | null,
    gateName: string,
  ): ConfigEvaluation {
    return this.evaluator.checkGate(user, gateName);
  }

  public getConfig(
    user: StatsigUser | null,
    configName: string,
  ): ConfigEvaluation {
    // TODO-HACK @tore use evaluator
    return this.evaluator.getConfig(user, configName);
  }

  public getExperiment(
    user: StatsigUser | null,
    expName: string,
  ): ConfigEvaluation {
    // TODO-HACK @tore use evaluator
    return this.evaluator.getConfig(user, expName);
  }

  public getLayer(
    user: StatsigUser | null,
    layerName: string,
  ): ConfigEvaluation {
    return this.evaluator.getLayer(user, layerName);
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
