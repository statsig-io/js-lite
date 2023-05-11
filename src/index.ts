import DynamicConfig from './DynamicConfig';
import { StatsigUninitializedError } from './Errors';
import Layer from './Layer';
import StatsigClient from './StatsigClient';
import { StatsigOptions } from './StatsigSDKOptions';
import { EvaluationDetails, EvaluationReason } from './StatsigStore';
import { StatsigUser } from './StatsigUser';

export { default as DynamicConfig } from './DynamicConfig';
export { StatsigEnvironment, StatsigOptions } from './StatsigSDKOptions';
export { EvaluationReason } from './StatsigStore';
export type { EvaluationDetails } from './StatsigStore';
export { StatsigUser } from './StatsigUser';

export default class Statsig {
  private static instance: StatsigClient | null = null;

  public static async initialize(
    sdkKey: string,
    user?: StatsigUser | null,
    options?: StatsigOptions | null,
  ): Promise<void> {
    const inst = Statsig.instance ?? new StatsigClient(sdkKey, user, options);

    if (!Statsig.instance) {
      Statsig.instance = inst;
    }

    return inst.initializeAsync();
  }

  public static setInitializeValues(
    initializeValues: Record<string, unknown>,
  ): void {
    Statsig._getClientX().setInitializeValues(initializeValues);
  }

  public static checkGate(gateName: string): boolean {
    return Statsig._getClientX().checkGate(gateName);
  }

  public static getConfig(configName: string): DynamicConfig {
    return Statsig._getClientX().getConfig(configName);
  }

  public static getExperiment(experimentName: string): DynamicConfig {
    return Statsig._getClientX().getConfig(experimentName);
  }

  public static getLayer(layerName: string): Layer {
    return Statsig._getClientX().getLayer(layerName);
  }

  public static logEvent(
    eventName: string,
    value: string | number | null = null,
    metadata: Record<string, string> | null = null,
  ): void {
    return Statsig._getClientX().logEvent(eventName, value, metadata);
  }

  public static updateUser(user: StatsigUser | null): Promise<boolean> {
    return Statsig._getClientX().updateUser(user);
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
