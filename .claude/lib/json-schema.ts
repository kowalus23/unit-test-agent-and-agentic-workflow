// Minimal JSON Schema validator for the subset used by .claude/schemas/*.json:
// type (object, array, string, integer, number, boolean), properties, required,
// additionalProperties: false, items, enum, maxLength, maxItems, minimum.
// The agent's structured result is validated with it before anything is rendered.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Schema = {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  enum?: unknown[];
  maxLength?: number;
  maxItems?: number;
  minimum?: number;
};

export const AGENT_RESULT_SCHEMA_PATH = fileURLToPath(new URL('../schemas/agent-result.schema.json', import.meta.url));

export function loadSchema(path: string = AGENT_RESULT_SCHEMA_PATH): Schema {
  return JSON.parse(readFileSync(path, 'utf8')) as Schema;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** Returns a list of validation errors (empty when the value conforms). */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const actual = typeOf(value);
    const ok = schema.type === actual || (schema.type === 'number' && actual === 'integer');
    if (!ok) return [...errors, `${path}: expected ${schema.type}, got ${actual}`];
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items!, item, `${path}[${index}]`)));
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${path}.${key}: required`);
    for (const [key, child] of Object.entries(record)) {
      const property = schema.properties?.[key];
      if (property) errors.push(...validate(property, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

/** Extracts the last fenced ```json block (or a bare JSON object) from model text. */
export function extractJsonBlock(text: string): unknown {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const candidate = blocks.length > 0 ? blocks[blocks.length - 1][1] : text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
