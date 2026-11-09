/** An error whose message is safe to show in the UI. */
export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

const CONNECTION_STRING_PATTERN = /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi;

/** Strips anything that looks like a connection string (which may embed credentials). */
export function redactSecrets(text: string): string {
  return text.replace(CONNECTION_STRING_PATTERN, 'mongodb://<redacted>');
}
