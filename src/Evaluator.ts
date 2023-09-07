import ConfigEvaluation from './ConfigEvaluation';
import { ConfigCondition, ConfigRule, ConfigSpec } from './ConfigSpec';
import { StatsigUnsupportedEvaluationError } from './Errors';
import { EvaluationDetails, EvaluationReason } from './EvaluationMetadata';
import StatsigIdentity from './StatsigIdentity';
import StatsigSDKOptions from './StatsigSDKOptions';
import StatsigStore from './StatsigStore';
import { StatsigUser } from './StatsigUser';
import { sha256create } from './utils/js-sha256';

const CONDITION_SEGMENT_COUNT = 10 * 1000;
const USER_BUCKET_COUNT = 1000;

export default class Evaluator {
  private store: StatsigStore;

  public constructor(options: StatsigSDKOptions, identity: StatsigIdentity) {
    this.store = new StatsigStore(options, identity);
  }

  public getConfig(user: StatsigUser, configName: string): ConfigEvaluation {
    const config = this.store.getDynamicConfig(configName);
    if (config === null) {
      return new ConfigEvaluation(false, '').withEvaluationReason(
        EvaluationReason.Unrecognized,
      );
    }
    return this.evalConfigSpec(user, config);
  }

  public checkGate(user: StatsigUser, gateName: string): ConfigEvaluation {
    const config = this.store.getFeatureGate(gateName);
    if (config === null) {
      return new ConfigEvaluation(false, '').withEvaluationReason(
        EvaluationReason.Unrecognized,
      );
    }
    return this.evalConfigSpec(user, config);
  }

  public getLayer(user: StatsigUser, layerName: string): ConfigEvaluation {
    const layer = this.store.getLayerConfig(layerName);
    if (layer === null) {
      return new ConfigEvaluation(false, '').withEvaluationReason(
        EvaluationReason.Unrecognized,
      );
    }
    return this.evalConfigSpec(user, layer);
  }

  public save(values: Record<string, any>): void {
    this.store.save(values);
  }

  public getGlobalEvaluationDetails(): EvaluationDetails {
    return this.store.getGlobalEvaluationDetails();
  }

  public setInitializeValues(initializeValues: Record<string, unknown>): void {
    this.store.setInitializeValues(initializeValues);
  }

  public evalConfigSpec(
    user: StatsigUser,
    config: ConfigSpec | null,
  ): ConfigEvaluation {
    if (config === null) {
      return new ConfigEvaluation(false, '').withEvaluationReason(
        EvaluationReason.Unrecognized,
      );
    }
    const evaulation = this._eval(user, config);
    return evaulation.withEvaluationReason(EvaluationReason.Network);
  }

  private _eval(user: StatsigUser, config: ConfigSpec): ConfigEvaluation {
    if (!config.enabled) {
      return new ConfigEvaluation(
        false,
        'disabled',
        [],
        config.defaultValue as Record<string, unknown>,
      );
    }

    let secondary_exposures: Record<string, string>[] = [];
    try {
      for (let i = 0; i < config.rules.length; i++) {
        const rule = config.rules[i];
        const ruleResult = this._evalRule(user, rule);

        secondary_exposures = secondary_exposures.concat(
          ruleResult.secondary_exposures,
        );

        if (ruleResult.value === true) {
          const delegatedResult = this._evalDelegate(
            user,
            rule,
            secondary_exposures,
          );
          if (delegatedResult) {
            return delegatedResult;
          }

          const pass = this._evalPassPercent(user, rule, config);
          const evaluation = new ConfigEvaluation(
            pass,
            ruleResult.rule_id,
            secondary_exposures,
            pass
              ? ruleResult.json_value
              : (config.defaultValue as Record<string, unknown>),
            config.explicitParameters,
            ruleResult.config_delegate,
          );
          evaluation.setIsExperimentGroup(ruleResult.is_experiment_group);
          return evaluation;
        }
      }
    } catch (e: unknown) {
      if (e instanceof StatsigUnsupportedEvaluationError) {
        return new ConfigEvaluation(
          false,
          'default',
          secondary_exposures,
          config.defaultValue as Record<string, unknown>,
          config.explicitParameters,
        ).withEvaluationReason(EvaluationReason.Unsupported);
      } else {
        // other error, let error boundary handle this
        throw e;
      }
    }

    return new ConfigEvaluation(
      false,
      'default',
      secondary_exposures,
      config.defaultValue as Record<string, unknown>,
      config.explicitParameters,
    );
  }

  private _evalDelegate(
    user: StatsigUser,
    rule: ConfigRule,
    exposures: Record<string, string>[],
  ) {
    if (rule.configDelegate == null) {
      return null;
    }
    const config = this.store.getDynamicConfig(rule.configDelegate);
    if (!config) {
      return null;
    }

    const delegatedResult = this._eval(user, config);
    delegatedResult.config_delegate = rule.configDelegate;
    delegatedResult.undelegated_secondary_exposures = exposures;
    delegatedResult.explicit_parameters = config.explicitParameters;
    delegatedResult.secondary_exposures = exposures.concat(
      delegatedResult.secondary_exposures,
    );

    return delegatedResult;
  }

  private _evalPassPercent(
    user: StatsigUser,
    rule: ConfigRule,
    config: ConfigSpec,
  ) {
    if (rule.passPercentage === 100) {
      return true;
    } else if (rule.passPercentage === 0) {
      return false;
    }
    const hash = computeUserHash(
      config.salt +
        '.' +
        (rule.salt ?? rule.id) +
        '.' +
        (this._getUnitID(user, rule.idType) ?? ''),
    );
    return (
      Number(hash % BigInt(CONDITION_SEGMENT_COUNT)) < rule.passPercentage * 100
    );
  }

  private _getUnitID(user: StatsigUser, idType: string) {
    if (typeof idType === 'string' && idType.toLowerCase() !== 'userid') {
      return (
        user?.customIDs?.[idType] ?? user?.customIDs?.[idType.toLowerCase()]
      );
    }
    return user?.userID;
  }

  private _evalRule(user: StatsigUser, rule: ConfigRule) {
    let secondaryExposures: Record<string, string>[] = [];
    let pass = true;

    for (const condition of rule.conditions) {
      const result = this._evalCondition(user, condition);
      if (!result.passes) {
        pass = false;
      }
      if (result.exposures) {
        secondaryExposures = secondaryExposures.concat(result.exposures);
      }
    }

    const evaluation = new ConfigEvaluation(
      pass,
      rule.id,
      secondaryExposures,
      rule.returnValue as Record<string, unknown>,
    );
    evaluation.withGroupName(rule.groupName);
    evaluation.setIsExperimentGroup(rule.isExperimentGroup ?? false);
    return evaluation;
  }

  private _evalCondition(
    user: StatsigUser,
    condition: ConfigCondition,
  ): { passes: boolean; fetchFromServer?: boolean; exposures?: any[] } {
    let value: unknown | null = null;
    const field = condition.field;
    const target = condition.targetValue;
    const idType = condition.idType;
    switch (condition.type.toLowerCase()) {
      case 'public':
        return { passes: true };
      case 'fail_gate':
      case 'pass_gate': {
        const nestedGate = this.store.getFeatureGate(target as string);
        const gateResult = this.evalConfigSpec(
          user,
          nestedGate,
        );
        value = gateResult?.value;

        const allExposures = gateResult?.secondary_exposures ?? [];
        allExposures.push({
          gate: String(target),
          gateValue: String(value),
          ruleID: gateResult?.rule_id ?? '',
        });

        return {
          passes:
            condition.type.toLowerCase() === 'fail_gate' ? !value : !!value,
          exposures: allExposures,
        };
      }
      case 'ip_based':
        // this would apply to things like 'country', 'region', etc.
        throw new StatsigUnsupportedEvaluationError(
          'Unsupported condition: ' + condition.type,
        );
      case 'ua_based':
        // this would apply to things like 'os', 'browser', etc.
        throw new StatsigUnsupportedEvaluationError(
          'Unsupported condition: ' + condition.type,
        );
      case 'user_field':
        value = getFromUser(user, field);
        break;
      case 'environment_field':
        value = getFromEnvironment(user, field);
        break;
      case 'current_time':
        value = Date.now();
        break;
      case 'user_bucket': {
        const salt = condition.additionalValues?.salt;
        const userHash = computeUserHash(
          salt + '.' + this._getUnitID(user, idType) ?? '',
        );
        value = Number(userHash % BigInt(USER_BUCKET_COUNT));
        break;
      }
      case 'unit_id':
        value = this._getUnitID(user, idType);
        break;
      case 'javascript': {
        const js = condition.additionalValues?.javascript;
        if (js !== null) {
          value = eval(js as string);
        }
        break;
      }
      default:
        throw new StatsigUnsupportedEvaluationError(
          'Unsupported condition: ' + condition.type,
        );
    }

    const op = condition.operator?.toLowerCase();
    let evalResult = false;
    switch (op) {
      // numerical
      case 'gt':
        evalResult = numberCompare((a: number, b: number) => a > b)(
          value,
          target,
        );
        break;
      case 'gte':
        evalResult = numberCompare((a: number, b: number) => a >= b)(
          value,
          target,
        );
        break;
      case 'lt':
        evalResult = numberCompare((a: number, b: number) => a < b)(
          value,
          target,
        );
        break;
      case 'lte':
        evalResult = numberCompare((a: number, b: number) => a <= b)(
          value,
          target,
        );
        break;

      // version
      case 'version_gt':
        evalResult = versionCompareHelper((result) => result > 0)(
          value as string,
          target as string,
        );
        break;
      case 'version_gte':
        evalResult = versionCompareHelper((result) => result >= 0)(
          value as string,
          target as string,
        );
        break;
      case 'version_lt':
        evalResult = versionCompareHelper((result) => result < 0)(
          value as string,
          target as string,
        );
        break;
      case 'version_lte':
        evalResult = versionCompareHelper((result) => result <= 0)(
          value as string,
          target as string,
        );
        break;
      case 'version_eq':
        evalResult = versionCompareHelper((result) => result === 0)(
          value as string,
          target as string,
        );
        break;
      case 'version_neq':
        evalResult = versionCompareHelper((result) => result !== 0)(
          value as string,
          target as string,
        );
        break;

      // array
      case 'any':
        evalResult = arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a === b),
        );
        break;
      case 'none':
        evalResult = !arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a === b),
        );
        break;
      case 'any_case_sensitive':
        evalResult = arrayAny(
          value,
          target,
          stringCompare(false, (a, b) => a === b),
        );
        break;
      case 'none_case_sensitive':
        evalResult = !arrayAny(
          value,
          target,
          stringCompare(false, (a, b) => a === b),
        );
        break;

      // string
      case 'str_starts_with_any':
        evalResult = arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a.startsWith(b)),
        );
        break;
      case 'str_ends_with_any':
        evalResult = arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a.endsWith(b)),
        );
        break;
      case 'str_contains_any':
        evalResult = arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a.includes(b)),
        );
        break;
      case 'str_contains_none':
        evalResult = !arrayAny(
          value,
          target,
          stringCompare(true, (a, b) => a.includes(b)),
        );
        break;
      case 'str_matches':
        try {
          if (String(value).length < 1000) {
            evalResult = new RegExp(target as string).test(String(value));
          } else {
            evalResult = false;
          }
        } catch (e) {
          evalResult = false;
        }
        break;
      // strictly equals
      case 'eq':
        evalResult = value == target;
        break;
      case 'neq':
        evalResult = value != target;
        break;

      // dates
      case 'before':
        evalResult = dateCompare((a, b) => a < b)(
          value as string,
          target as string,
        );
        break;
      case 'after':
        evalResult = dateCompare((a, b) => a > b)(
          value as string,
          target as string,
        );
        break;
      case 'on':
        evalResult = dateCompare((a, b) => {
          a?.setHours(0, 0, 0, 0);
          b?.setHours(0, 0, 0, 0);
          return a?.getTime() === b?.getTime();
        })(value as string, target as string);
        break;
      case 'in_segment_list':
      case 'not_in_segment_list':
        throw new StatsigUnsupportedEvaluationError(
          'Unsupported condition operator: ' + op,
        );
      default:
        throw new StatsigUnsupportedEvaluationError(
          'Unsupported condition operator: ' + op,
        );
    }
    return { passes: evalResult };
  }
}

function computeUserHash(userHash: string) {
  const buffer = sha256create().update(userHash).array();
  const ab = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(ab);
  for (let ii = 0; ii < buffer.length; ii++) {
    view[ii] = buffer[ii];
  }

  const dv = new DataView(ab);
  const hash = dv.getBigUint64(0, false);
  return hash;
}

function getFromEnvironment(user: StatsigUser, field: string) {
  return getParameterCaseInsensitive(user?.statsigEnvironment, field);
}

function getParameterCaseInsensitive(
  object: Record<string, unknown> | undefined | null,
  key: string,
): unknown | undefined {
  if (object == null) {
    return undefined;
  }
  const asLowercase = key.toLowerCase();
  const keyMatch = Object.keys(object).find(
    (k) => k.toLowerCase() === asLowercase,
  );
  if (keyMatch === undefined) {
    return undefined;
  }
  return object[keyMatch];
}

function getFromUser(user: StatsigUser, field: string): any | null {
  if (typeof user !== 'object' || user == null) {
    return null;
  }
  const indexableUser = user as { [field: string]: unknown };

  return (
    indexableUser[field] ??
    indexableUser[field.toLowerCase()] ??
    user?.custom?.[field] ??
    user?.custom?.[field.toLowerCase()] ??
    user?.privateAttributes?.[field] ??
    user?.privateAttributes?.[field.toLowerCase()]
  );
}

function numberCompare(
  fn: (a: number, b: number) => boolean,
): (a: unknown, b: unknown) => boolean {
  return (a: unknown, b: unknown) => {
    if (a == null || b == null) {
      return false;
    }
    const numA = Number(a);
    const numB = Number(b);
    if (isNaN(numA) || isNaN(numB)) {
      return false;
    }
    return fn(numA, numB);
  };
}

function versionCompareHelper(
  fn: (res: number) => boolean,
): (a: string | null, b: string | null) => boolean {
  return (a: string | null, b: string | null) => {
    const comparison = versionCompare(a, b);
    if (comparison == null) {
      return false;
    }
    return fn(comparison);
  };
}

// Compare two version strings without the extensions.
// returns -1, 0, or 1 if first is smaller than, equal to, or larger than second.
// returns false if any of the version strings is not valid.
function versionCompare(
  first: string | null,
  second: string | null,
): number | null {
  if (
    first == null ||
    second == null ||
    typeof first !== 'string' ||
    typeof second !== 'string'
  ) {
    return null;
  }
  const version1 = removeVersionExtension(first);
  const version2 = removeVersionExtension(second);
  if (version1.length === 0 || version2.length === 0) {
    return null;
  }

  const parts1 = version1.split('.');
  const parts2 = version2.split('.');
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    if (parts1[i] === undefined) {
      parts1[i] = '0';
    }
    if (parts2[i] === undefined) {
      parts2[i] = '0';
    }
    const n1 = Number(parts1[i]);
    const n2 = Number(parts2[i]);
    if (
      typeof n1 !== 'number' ||
      typeof n2 !== 'number' ||
      isNaN(n1) ||
      isNaN(n2)
    ) {
      return null;
    }
    if (n1 < n2) {
      return -1;
    } else if (n1 > n2) {
      return 1;
    }
  }
  return 0;
}

function removeVersionExtension(version: string): string {
  const hyphenIndex = version.indexOf('-');
  if (hyphenIndex >= 0) {
    return version.substr(0, hyphenIndex);
  }
  return version;
}

function stringCompare(
  ignoreCase: boolean,
  fn: (a: string, b: string) => boolean,
): (a: string | null, b: string | null) => boolean {
  return (a: string | null, b: string | null): boolean => {
    if (a == null || b == null) {
      return false;
    }
    return ignoreCase
      ? fn(String(a).toLowerCase(), String(b).toLowerCase())
      : fn(String(a), String(b));
  };
}

function dateCompare(
  fn: (a: Date, b: Date) => boolean,
): (a: string | null, b: string | null) => boolean {
  return (a: string | null, b: string | null): boolean => {
    if (a == null || b == null) {
      return false;
    }
    try {
      // Try to parse into date as a string first, if not, try unixtime
      let dateA = new Date(a);
      if (isNaN(dateA.getTime())) {
        dateA = new Date(Number(a));
      }

      let dateB = new Date(b);
      if (isNaN(dateB.getTime())) {
        dateB = new Date(Number(b));
      }
      return (
        !isNaN(dateA.getTime()) && !isNaN(dateB.getTime()) && fn(dateA, dateB)
      );
    } catch (e) {
      // malformatted input, returning false
      return false;
    }
  };
}

function arrayAny(
  value: any,
  array: unknown,
  fn: (value: any, otherValue: any) => boolean,
): boolean {
  if (!Array.isArray(array)) {
    return false;
  }
  for (let i = 0; i < array.length; i++) {
    if (fn(value, array[i])) {
      return true;
    }
  }
  return false;
}
