import { z } from 'zod';

const fields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  priority: z.enum(['low', 'medium', 'high']),
  due_date: z.iso.date().nullable(),
  completed: z.boolean(),
};

export const createSchema = z.strictObject({
  ...fields,
  description: fields.description.default(''),
  priority: fields.priority.default('medium'),
  due_date: fields.due_date.default(null),
  completed: fields.completed.default(false),
});
export const updateSchema = z.strictObject(fields).partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update.',
);
// Path ids are canonical decimal integers within PostgreSQL's int4 range (`id SERIAL`):
// '0x10', '1e3', '+5' or '012' are rejected instead of being coerced, and ids the column
// cannot hold are a validation error (422) rather than a database error (500).
export const MAX_TODO_ID = 2_147_483_647;
export const idSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(MAX_TODO_ID));
// DELETE /api/todos removes data in bulk, so the intent must be explicit:
// only ?completed=true is accepted, any other or missing query is a 422.
export const clearCompletedQuerySchema = z.strictObject({ completed: z.literal('true') });
export const todoSchema = createSchema.extend({
  id: z.number().int().positive(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
