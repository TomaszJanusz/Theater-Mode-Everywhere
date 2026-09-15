export type ProviderErrorCode =
  | 'unsupported'
  | 'timeout'
  | 'aborted'
  | 'schema-changed'
  | 'network-blocked'
  | 'network-failed'
  | 'host-command-failed';

export type ProviderError = {
  code: ProviderErrorCode;
  provider?: string;
  capability?: string;
  epoch?: number;
  cause?: unknown;
};

export function providerError(
  code: ProviderErrorCode,
  extras: Omit<ProviderError, 'code'> = {}
): ProviderError {
  return { code, ...extras };
}
