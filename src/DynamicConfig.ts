import { EvaluationDetails } from './EvaluationMetadata';

export type OnDefaultValueFallback = (
  config: DynamicConfig,
  parameter: string,
  defaultValueType: string,
  valueType: string,
) => void;

export default class DynamicConfig {
  public value: Record<string, any>;

  readonly _name: string;
  readonly _ruleID: string;
  readonly _secondaryExposures: Record<string, string>[];
  readonly _allocatedExperimentName: string;
  readonly _evaluationDetails: EvaluationDetails;
  readonly _onDefaultValueFallback: OnDefaultValueFallback | null = null;

  constructor(
    configName: string,
    configValue: Record<string, any>,
    ruleID: string,
    evaluationDetails: EvaluationDetails,
    secondaryExposures: Record<string, string>[] = [],
    allocatedExperimentName: string = '',
    onDefaultValueFallback: OnDefaultValueFallback | null = null,
  ) {
    this.value = JSON.parse(JSON.stringify(configValue ?? {}));

    this._name = configName;
    this._ruleID = ruleID ?? '';
    this._secondaryExposures = secondaryExposures;
    this._allocatedExperimentName = allocatedExperimentName;
    this._evaluationDetails = evaluationDetails;
    this._onDefaultValueFallback = onDefaultValueFallback;
  }

  public get<T>(
    key: string,
    defaultValue: T,
    typeGuard?: (value: unknown) => value is T,
  ): T {
    console.log('get', key, defaultValue, typeGuard, this._onDefaultValueFallback);
    const val = this.getValue(key, defaultValue);

    if (val == null) {
      console.log('null value,return defult');
      return defaultValue;
    }

    const expectedType = Array.isArray(defaultValue)
      ? 'array'
      : typeof defaultValue;
    const actualType = Array.isArray(val) ? 'array' : typeof val;

    if (typeGuard) {
      if (typeGuard(val)) {
        console.log('typeguard success');
        return val;
      }
      console.log('typeguard fail');
      this._onDefaultValueFallback?.(this, key, expectedType, actualType);
      return defaultValue;
    }

    if (defaultValue == null || expectedType === actualType) {
      console.log('match ');
      return val as unknown as T;
    }
    console.log('fallback ');
    this._onDefaultValueFallback?.(this, key, expectedType, actualType);
    return defaultValue;
  }

  public getValue(
    key?: string,
    defaultValue?: any | null,
  ): boolean | number | string | object | Array<any> | null {
    if (key == null) {
      return this.value;
    }
    if (defaultValue == null) {
      defaultValue = null;
    }
    if (this.value[key] == null) {
      return defaultValue;
    }
    return this.value[key];
  }
}
