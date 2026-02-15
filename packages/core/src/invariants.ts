export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

export function assertNonEmptyString(value: string, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvariantError(`${name} must be a non-empty string`);
  }
}

export function assertPositiveInt(value: number, name: string): asserts value is number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvariantError(`${name} must be a positive integer`);
  }
}
