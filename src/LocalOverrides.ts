import StatsigLocalStorage from './utils/StatsigLocalStorage';

export const STORAGE_KEY = 'STATSIG_JS_LITE_LOCAL_OVERRIDES';

export function makeEmptyOverrides() {
  return { gates: {}, configs: {}, layers: {} };
}

export type LocalOverrides = {
  gates: { [gateName: string]: boolean };
  configs: { [configName: string]: Record<string, unknown> };
  layers: { [layerName: string]: Record<string, unknown> };
};

export function loadOverridesFromLocalStorage(): LocalOverrides {
  const raw = StatsigLocalStorage.getItem(STORAGE_KEY);

  if (raw) {
    try {
      return JSON.parse(raw) as LocalOverrides;
    } catch (error) {
      // noop
    }
  }

  return makeEmptyOverrides();
}

export function saveOverridesToLocalStorage(overrides: LocalOverrides) {
  StatsigLocalStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}
