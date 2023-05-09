import type { StatsigUser } from './StatsigUser';
import { StatsigMetadata } from './StatsigIdentity';

export type LogEvent = {
  eventName: string;
  user: StatsigUser | null;
  value: string | number | null;
  metadata: object | null;
  time: number;
  statsigMetadata: StatsigMetadata & Record<string, string>;
  secondaryExposures?: Record<string, string>[];
};

export default function makeLogEvent(
  eventName: string,
  user: StatsigUser | null,
  statsigMetadata: StatsigMetadata,
  value: string | number | null = null,
  metadata: object | null = null,
  secondaryExposures?: Record<string, string>[],
): LogEvent {
  return {
    time: Date.now(),
    eventName,
    statsigMetadata,
    user,
    value,
    metadata,
    secondaryExposures,
  };
}
