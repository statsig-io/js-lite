import { EvaluationDetails } from './EvaluationMetadata';

export type LogParameterFunction = (
  layer: Layer,
  parameterName: string,
) => void;

export default class Layer {
  readonly _name: string;
  readonly _value: Record<string, any>;
  readonly _ruleID: string;
  readonly _secondaryExposures: Record<string, string>[];
  readonly _undelegatedSecondaryExposures: Record<string, string>[];
  readonly _allocatedExperimentName: string;
  readonly _explicitParameters: string[];
  readonly _evaluationDetails: EvaluationDetails;
  readonly _logParameterFunction: LogParameterFunction | null;

  private constructor(
    name: string,
    layerValue: Record<string, any>,
    ruleID: string,
    evaluationDetails: EvaluationDetails,
    logParameterFunction: LogParameterFunction | null = null,
    secondaryExposures: Record<string, string>[] = [],
    undelegatedSecondaryExposures: Record<string, string>[] = [],
    allocatedExperimentName: string = '',
    explicitParameters: string[] = [],
  ) {
    this._logParameterFunction = logParameterFunction;
    this._name = name;
    this._value = JSON.parse(JSON.stringify(layerValue ?? {}));
    this._ruleID = ruleID ?? '';
    this._evaluationDetails = evaluationDetails;
    this._secondaryExposures = secondaryExposures;
    this._undelegatedSecondaryExposures = undelegatedSecondaryExposures;
    this._allocatedExperimentName = allocatedExperimentName;
    this._explicitParameters = explicitParameters;
  }

  static _create(
    name: string,
    value: Record<string, any>,
    ruleID: string,
    evaluationDetails: EvaluationDetails,
    logParameterFunction: LogParameterFunction | null = null,
    secondaryExposures: Record<string, string>[] = [],
    undelegatedSecondaryExposures: Record<string, string>[] = [],
    allocatedExperimentName: string = '',
    explicitParameters: string[] = [],
  ): Layer {
    return new Layer(
      name,
      value,
      ruleID,
      evaluationDetails,
      logParameterFunction,
      secondaryExposures,
      undelegatedSecondaryExposures,
      allocatedExperimentName,
      explicitParameters,
    );
  }

  public get<T>(
    key: string,
    defaultValue: T,
    typeGuard?: (value: unknown) => value is T,
  ): T {
    const val = this._value[key];

    if (val == null) {
      return defaultValue;
    }

    const logAndReturn = () => {
      this._logLayerParameterExposure(key);
      return val as unknown as T;
    };

    if (typeGuard) {
      return typeGuard(val) ? logAndReturn() : defaultValue;
    }

    if (defaultValue == null) {
      return logAndReturn();
    }

    if (
      typeof val === typeof defaultValue &&
      Array.isArray(defaultValue) === Array.isArray(val)
    ) {
      return logAndReturn();
    }

    return defaultValue;
  }

  public getValue(
    key: string,
    defaultValue?: any | null,
  ): boolean | number | string | object | Array<any> | null {
    if (defaultValue == undefined) {
      defaultValue = null;
    }

    const val = this._value[key];
    if (val != null) {
      this._logLayerParameterExposure(key);
    }

    return val ?? defaultValue;
  }

  private _logLayerParameterExposure(parameterName: string) {
    this._logParameterFunction?.(this, parameterName);
  }
}
