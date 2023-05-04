import { _SDKPackageInfo } from './StatsigClient';
import { StatsigUser } from './StatsigUser';
import { STATSIG_STABLE_ID_KEY } from './utils/Constants';
import StatsigLocalStorage from './utils/StatsigLocalStorage';

import { version as SDKVersion } from './SDKVersion';

export type DeviceInfo = {
  getVersion(): string | null;
  getSystemVersion(): string | null;
  getSystemName(): string | null;
  getModel(): string | null;
  getDeviceId(): string | null;
};

export type ExpoConstants = {
  nativeAppVersion: string | null;
  nativeBuildVersion: string | null;
};

export type ExpoDevice = {
  osVersion: string | null;
  osName: string | null;
  modelName: string | null;
  modelId: string | null;
};

export type NativeModules = {
  I18nManager?: {
    localeIdentifier: string;
  } | null;
  SettingsManager?: {
    settings: {
      AppleLocale: string | null;
      AppleLanguages: string[];
    } | null;
  } | null;
};

export type Platform = {
  OS?: {
    toLocaleLowerCase: () => string;
  } | null;
};

type StatsigMetadata = {
  sdkType: string;
  sdkVersion: string;
  stableID?: string;
  locale?: string;
  appVersion?: string;
  systemVersion?: string;
  systemName?: string;
  deviceModelName?: string;
  deviceModel?: string;
};

export default class Identity {
  private user: StatsigUser | null;
  private statsigMetadata: StatsigMetadata;
  private sdkType: string = 'js-client';
  private sdkVersion: string;

  public constructor(
    user: StatsigUser | null,
    overrideStableID?: string | null,
  ) {
    this.user = user;
    this.sdkVersion = SDKVersion;
    this.statsigMetadata = {
      sdkType: this.sdkType,
      sdkVersion: this.sdkVersion,
    };

    let stableID = overrideStableID;
    stableID =
        stableID ??
        StatsigLocalStorage.getItem(STATSIG_STABLE_ID_KEY) ??
        this.getUUID();
    if (stableID) {
      this.statsigMetadata.stableID = stableID;
    }
  }

  public saveStableID(): void {
    if (this.statsigMetadata.stableID != null) {
      StatsigLocalStorage.setItem(
        STATSIG_STABLE_ID_KEY,
        this.statsigMetadata.stableID,
      );
    }
  }

  public getSDKType(): string {
    return this.sdkType;
  }

  public getSDKVersion(): string {
    return this.sdkVersion;
  }

  public getStatsigMetadata(): Record<string, string> {
    this.statsigMetadata.sdkType = this.sdkType;
    this.statsigMetadata.sdkVersion = this.sdkVersion;
    return this.statsigMetadata;
  }

  public getUser(): StatsigUser | null {
    return this.user;
  }

  public updateUser(user: StatsigUser | null): void {
    this.user = user;
  }

  private getUUID(): string {
    let uuid = '';
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += '-';
      }
      const randomDigit = Math.random() * 16 | 0;
      if (i === 12) {
        uuid += '4';
      } else if (i === 16) {
        uuid += (randomDigit & 3 | 8).toString(16);
      } else {
        uuid += randomDigit.toString(16);
      }
    }
    return uuid;
  }
}
