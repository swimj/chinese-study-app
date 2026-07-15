import type { JsonValue } from './types.js';
import type { JsonSchema } from './result-schema.js';

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'boolean':
      return typeof value === expected;
    default:
      return false;
  }
}

function validateAt(value: unknown, schema: JsonSchema, path: string): string[] {
  if (schema.anyOf !== undefined) {
    const branchErrors = schema.anyOf.map((branch) => validateAt(value, branch, path));
    if (branchErrors.some((errors) => errors.length === 0)) return [];
    const shortest = [...branchErrors].sort((left, right) => left.length - right.length)[0] ?? [];
    return [`${path}: does not match any allowed schema`, ...shortest.slice(0, 3)];
  }

  if (schema.type !== undefined) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some((type) => matchesType(value, type))) {
      return [`${path}: expected ${allowedTypes.join(' or ')}, got ${valueType(value)}`];
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    return [`${path}: value is not in the allowed enum`];
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    return value.flatMap((item, index) => validateAt(item, schema.items!, `${path}[${index}]`));
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value) && schema.properties !== undefined) {
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(record, required)) errors.push(`${path}.${required}: required property is missing`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}.${key}: unknown property`);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(record, key)) {
        errors.push(...validateAt(record[key], propertySchema, `${path}.${key}`));
      }
    }
    return errors;
  }

  return [];
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): string[] {
  return validateAt(value, schema, '$');
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}
