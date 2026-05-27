type Args = Record<string, unknown>;

export function getString(args: Args, name: string): string | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`Argument '${name}' must be a string`);
  return v;
}

export function requireString(args: Args, name: string): string {
  const v = getString(args, name);
  if (v === undefined || v === '') {
    throw new Error(`Missing required argument: ${name}`);
  }
  return v;
}

export function getNumber(args: Args, name: string): number | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  throw new Error(`Argument '${name}' must be a number`);
}

export function requireNumber(args: Args, name: string): number {
  const v = getNumber(args, name);
  if (v === undefined) throw new Error(`Missing required argument: ${name}`);
  return v;
}

export function getBoolean(args: Args, name: string): boolean | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  throw new Error(`Argument '${name}' must be a boolean`);
}

export function getStringArray(args: Args, name: string): string[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`Argument '${name}' must be an array of strings`);
  return v.map((item) => {
    if (typeof item !== 'string') throw new Error(`Argument '${name}' must contain strings only`);
    return item;
  });
}

export function getNumberArray(args: Args, name: string): number[] | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`Argument '${name}' must be an array of numbers`);
  return v.map((item) => {
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    throw new Error(`Argument '${name}' must contain numbers only`);
  });
}

export function getObject(args: Args, name: string): Record<string, unknown> | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`Argument '${name}' must be an object`);
  }
  return v as Record<string, unknown>;
}
