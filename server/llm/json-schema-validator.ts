import type { JsonSchema } from '../../src/domain/reflection-result-schema.js';

export type JsonSchemaValidationIssue = {
  path: string;
  code: 'required' | 'additional_properties' | 'type' | 'enum' | 'min_items' | 'any_of';
  message: string;
  valueType: string | null;
};

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

  if (Array.isArray(value)) {
    const errors: string[] = [];
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} item(s)`);
    }
    if (schema.items !== undefined) {
      errors.push(...value.flatMap((item, index) => (
        validateAt(item, schema.items!, `${path}[${index}]`)
      )));
    }
    return errors;
  }

  if (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && schema.properties !== undefined
  ) {
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(record, required)) {
        errors.push(`${path}.${required}: required property is missing`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(schema.properties, key)) {
          errors.push(`${path}.${key}: unknown property`);
        }
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

/** Structured companion to the legacy string validator used by existing callers. */
export function validateJsonSchemaIssues(
  value: unknown,
  schema: JsonSchema,
): JsonSchemaValidationIssue[] {
  return validateJsonSchema(value, schema).map((message) => {
    const separator = message.indexOf(': ');
    const path = separator < 0 ? '$' : message.slice(0, separator);
    const detail = separator < 0 ? message : message.slice(separator + 2);
    let code: JsonSchemaValidationIssue['code'] = 'any_of';
    if (detail.startsWith('required property is missing')) code = 'required';
    else if (detail.startsWith('unknown property')) code = 'additional_properties';
    else if (detail.startsWith('expected at least')) code = 'min_items';
    else if (detail.startsWith('expected ') && detail.includes(', got ')) code = 'type';
    else if (detail.startsWith('value is not in')) code = 'enum';
    return {
      path,
      code,
      message: detail,
      valueType: detail.match(/, got ([A-Za-z]+)/)?.[1] ?? null,
    };
  });
}
