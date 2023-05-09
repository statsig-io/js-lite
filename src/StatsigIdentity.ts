import { StatsigUser } from './StatsigUser';
import { STATSIG_STABLE_ID_KEY } from './utils/Constants';
import { getUserCacheKey } from './utils/Hashing';
import StatsigLocalStorage from './utils/StatsigLocalStorage';

import { version as SDKVersion } from './SDKVersion';

export type StatsigMetadata = {
  sdkType: string;
  sdkVersion: string;
  stableID: string;
  locale?: string;
  appVersion?: string;
  systemVersion?: string;
  systemName?: string;
  deviceModelName?: string;
  deviceModel?: string;
};

export default class Identity {
  _user: StatsigUser | null;

  readonly _sdkKey: string;
  readonly _statsigMetadata: StatsigMetadata;

  private _sdkType: string = 'js-client';

  private readonly _sdkVersion: string;

  constructor(
    sdkKey: string,
    user: StatsigUser | null,
    overrideStableID?: string | null,
  ) {
    this._sdkKey = sdkKey;
    this._user = user;
    this._sdkVersion = SDKVersion;

    let stableID = overrideStableID;
    stableID =
      stableID ??
      StatsigLocalStorage.getItem(STATSIG_STABLE_ID_KEY) ??
      this._getUUID();

    this._statsigMetadata = {
      stableID: stableID,
      sdkType: this._sdkType,
      sdkVersion: this._sdkVersion,
    };
  }

  saveStableID(): void {
    if (this._statsigMetadata.stableID != null) {
      StatsigLocalStorage.setItem(
        STATSIG_STABLE_ID_KEY,
        this._statsigMetadata.stableID,
      );
    }
  }

  getUserCacheKey(): string {
    return getUserCacheKey(this._user);
  }

  private _getUUID(): string {
    let uuid = '';
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += '-';
      }
      const randomDigit = (Math.random() * 16) | 0;
      if (i === 12) {
        uuid += '4';
      } else if (i === 16) {
        uuid += ((randomDigit & 3) | 8).toString(16);
      } else {
        uuid += randomDigit.toString(16);
      }
    }
    return uuid;
  }
}
