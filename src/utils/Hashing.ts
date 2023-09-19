import { StatsigUser } from '../StatsigUser';

export function SimpleHash(value: string): string {
  var hash = 0;
  for (var i = 0; i < value.length; i++) {
    var character = value.charCodeAt(i);
    hash = (hash << 5) - hash + character;
    hash = hash & hash; // Convert to 32bit integer
  }
  return String(hash >>> 0);
}

export function getHashValue(value: string): string {
  return SimpleHash(value);
}

export function djb2HashForObject(
  object: Record<string, unknown> | null,
): string {
  return SimpleHash(JSON.stringify(getSortedObject(object)));
}

export function getSortedObject(
  object: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (object == null) {
    return null;
  }
  const keys = Object.keys(object).sort();
  const sortedObject: Record<string, unknown> = {};
  keys.forEach((key) => {
    let value = object[key];
    if (value instanceof Object) {
      value = getSortedObject(value as Record<string, unknown>);
    }

    sortedObject[key] = value;
  });
  return sortedObject;
}

export function getUserCacheKey(user: StatsigUser | null): string {
  let key = `userID:${String(user?.userID ?? '')}`;

  const customIDs = user?.customIDs;
  if (customIDs != null) {
    for (const [type, value] of Object.entries(customIDs)) {
      key += `;${type}:${value}`;
    }
  }

  return SimpleHash(key);
}
