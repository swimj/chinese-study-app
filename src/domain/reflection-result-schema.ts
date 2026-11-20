/**
 * The provider-facing JSON Schema for the accepted reflection result contract.
 *
 * This lives with the shared domain contract so production generation and the
 * provider spike validate the same wire format.
 */
export type JsonSchema = {
  type?: string | string[];
  enum?: Array<string | number | boolean | null>;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
};
