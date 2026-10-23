import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteCompleted: vi.fn().mockResolvedValue(0) };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('gets a task by ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it.each(['get', 'patch', 'delete'] as const)('returns 404 for missing tasks (%s)', async (method) => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(null);
  repository.update.mockResolvedValue(null);
  repository.delete.mockResolvedValue(false);
  const response = await request(app)[method]('/api/todos/99').send({ title: 'Task' });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])('rejects invalid task IDs without calling the repository: %s', async (id) => {
  const { app, repository } = setup();
  const response = await request(app).get(`/api/todos/${id}`);
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: expect.any(Array) });
  expect(repository.get).not.toHaveBeenCalled();
});
it.each(['patch', 'delete'] as const)('rejects invalid task IDs on %s without calling the repository', async (method) => {
  const { app, repository } = setup();
  const response = await request(app)[method]('/api/todos/abc').send({ title: 'Task' });
  expect(response.status).toBe(422);
  expect(repository.update).not.toHaveBeenCalled();
  expect(repository.delete).not.toHaveBeenCalled();
});
it('updates tasks with trimmed input', async () => {
  const { app, repository } = setup();
  repository.update.mockResolvedValue({ ...todo, title: 'New' });
  const response = await request(app).patch('/api/todos/1').send({ title: '  New  ' });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ...todo, title: 'New' });
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'New' });
});
it('rejects empty patches with the validation message', async () => {
  const { app, repository } = setup();
  const response = await request(app).patch('/api/todos/1').send({});
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: [expect.objectContaining({ code: 'custom', path: [], message: 'Provide at least one field to update.' })] });
  expect(repository.update).not.toHaveBeenCalled();
});
it('deletes tasks with an empty 204 response', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it('clears completed tasks and reports how many were deleted', async () => {
  const { app, repository } = setup();
  repository.deleteCompleted.mockResolvedValue(3);
  const response = await request(app).delete('/api/todos?completed=true');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ deleted: 3 });
  expect(repository.deleteCompleted).toHaveBeenCalledOnce();
  expect(repository.delete).not.toHaveBeenCalled();
});
it.each(['', '?completed=false', '?completed=1', '?completed=true&completed=true', '?completed=true&extra=1', '?other=true'])(
  'rejects clearing completed tasks without an explicit completed=true query: %j', async (query) => {
    const { app, repository } = setup();
    const response = await request(app).delete(`/api/todos${query}`);
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ detail: expect.any(Array) });
    expect(repository.deleteCompleted).not.toHaveBeenCalled();
  },
);
it('reports the invalid field in create errors', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  ' });
  expect(response.status).toBe(422);
  expect(response.body.detail).toEqual([expect.objectContaining({ code: 'too_small', path: ['title'] })]);
  expect(repository.create).not.toHaveBeenCalled();
});
