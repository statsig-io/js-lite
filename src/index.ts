import DynamicConfig from './DynamicConfig';
import { StatsigUninitializedError } from './Errors';
import Layer from './Layer';
import StatsigClient, { CheckGateOptions, GetExperimentOptions, GetLayerOptions } from './StatsigClient';
import { StatsigOptions } from './StatsigSDKOptions';
import { EvaluationDetails, EvaluationReason } from './EvaluationMetadata';
import { StatsigUser } from './StatsigUser';

export { default as DynamicConfig } from './DynamicConfig';
export { StatsigEnvironment, StatsigOptions } from './StatsigSDKOptions';
export { EvaluationReason } from './EvaluationMetadata';
export type { EvaluationDetails } from './EvaluationMetadata';
export { StatsigUser } from './StatsigUser';

export default class Statsig {
  private static instance: StatsigClient | null = null;

  public static async initialize(
    sdkKey: string,
    options?: StatsigOptions | null,
  ): Promise<void> {
    const inst = Statsig.instance ?? new StatsigClient(sdkKey, options);

    if (!Statsig.instance) {
      Statsig.instance = inst;
    }

    return inst.initializeAsync();
  }

  // Gate

  public static checkGate(
    user: StatsigUser,
    gateName: string,
    options?: CheckGateOptions,
  ): boolean {
    return Statsig._getClientX().checkGate(user, gateName, options);
  }

  public static manuallyLogGateExposure(user: StatsigUser, gateName: string) {
    Statsig._getClientX().logGateExposure(user, gateName);
  }

  // Config
  public static getConfig(
    user: StatsigUser,
    configName: string,
  ): DynamicConfig {
    return Statsig._getClientX().getConfig(user, configName);
  }

  public static manuallyLogConfigExposure(user: StatsigUser, configName: string) {
    Statsig._getClientX().logConfigExposure(user, configName);
  }

  // Experiment
  public static getExperiment(
    user: StatsigUser,
    experimentName: string,
    options?: GetExperimentOptions,
  ): DynamicConfig {
    return Statsig._getClientX().getExperiment(user, experimentName, options);
  }

  public static manuallyLogExperimentExposure(user: StatsigUser,configName: string) {
    Statsig._getClientX().logExperimentExposure(user, configName);
  }

  // Layer
  public static getLayer(
    user: StatsigUser,
    layerName: string,
    options?: GetLayerOptions,
  ): Layer {
    return Statsig._getClientX().getLayer(user, layerName, options);
  }

  public static manuallyLogLayerParameterExposure(
    user: StatsigUser,
    layerName: string,
    parameterName: string,
  ) {
    Statsig._getClientX().logLayerParameterExposure(user, layerName, parameterName);
  }

  public static logEvent(
    user: StatsigUser,
    eventName: string,
    value: string | number | null = null,
    metadata: Record<string, string> | null = null,
  ): void {
    return Statsig._getClientX().logEvent(user, eventName, value, metadata);
  }

  public static shutdown() {
    Statsig._getClientX().shutdown();
    Statsig.instance = null;
  }

  /**
   * @returns The Statsig stable ID used for device level experiments
   */
  public static getStableID(): string {
    return Statsig._getClientX().getStableID();
  }

  /**
   *
   * @returns The reason and time associated with the evaluation for the current set
   * of gates and configs
   */
  public static getEvaluationDetails(): EvaluationDetails {
    return (
      Statsig.instance?.getEvaluationDetails() ?? {
        reason: EvaluationReason.Uninitialized,
        time: 0,
      }
    );
  }

  /**
   *
   * @returns true if initialize has already been called, false otherwise
   */
  public static initializeCalled(): boolean {
    return Statsig.instance != null && Statsig.instance.initializeCalled();
  }

  private static _getClientX(): StatsigClient {
    if (!Statsig.instance) {
      throw new StatsigUninitializedError();
    }
    return Statsig.instance;
  }
}
