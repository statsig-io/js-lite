import ErrorBoundary from '../ErrorBoundary';
import { StatsigSDKKeyMismatchError } from '../Errors';
import { SimpleHash } from './Hashing';

export function verifySDKKeyUsed(
  json: Record<string, unknown>,
  sdkKey: string,
  errorBoundary: ErrorBoundary,
): boolean {
  const hashedSDKKeyUsed = json?.hashed_sdk_key_used;
  if (
    hashedSDKKeyUsed != null &&
    hashedSDKKeyUsed !== SimpleHash(sdkKey ?? '')
  ) {
    errorBoundary._logError(
      'fetchAndSaveValues',
      new StatsigSDKKeyMismatchError(
        'The SDK key provided does not match the one used to generate values.',
      ),
    );
    return false;
  }
  return true;
}
