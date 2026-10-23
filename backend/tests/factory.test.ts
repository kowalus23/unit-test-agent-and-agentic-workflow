import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  // Real Prisma client on a closed port: an unmocked query fails fast instead of reaching a database.
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  return { database, app: createApp(database) };
}

it('serves tasks through the repository and the Prisma delegate', async () => {
  const { app, database } = setup();
  const findMany = vi.spyOn(database.todo, 'findMany').mockResolvedValue([record]);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(findMany).toHaveBeenCalledOnce();
});
it('serves the health check under /api', async () => {
  const { app, database } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledOnce();
});
it.each([['get', '/nope'], ['put', '/api/todos/1'], ['post', '/api/health']] as const)('returns a JSON 404 for unknown routes: %s %s', async (method, path) => {
  const { app } = setup();
  const response = await request(app)[method](path);
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it.each(['{bad', 'null'])('rejects malformed JSON bodies: %s', async (body) => {
  const { app, database } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const response = await request(app).post('/api/todos').set('Content-Type', 'application/json').send(body);
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(create).not.toHaveBeenCalled();
});
it('rejects bodies over the size limit', async () => {
  const { app, database } = setup();
  const create = vi.spyOn(database.todo, 'create');
  const response = await request(app).post('/api/todos').send({ title: 'x'.repeat(200 * 1024) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
  expect(create).not.toHaveBeenCalled();
});
it('hides unexpected errors behind a generic 500 and logs them', async () => {
  const { app, database } = setup();
  const error = new Error('connect ECONNREFUSED 10.0.0.5:5432');
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(response.text).not.toContain('ECONNREFUSED');
  expect(log).toHaveBeenCalledWith(error);
});
it('does not advertise Express', async () => {
  const { app } = setup();
  expect((await request(app).get('/nope')).headers['x-powered-by']).toBeUndefined();
});
it('serves the OpenAPI document and redirects /docs', async () => {
  const { app } = setup();
  const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  expect((await request(app).get('/openapi.json')).body).toEqual(specification);
  const docs = await request(app).get('/docs');
  expect(docs.status).toBe(301);
  expect(docs.headers.location).toBe('/docs/');
});
it('leaves errors after headers were sent to Express', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findMany').mockRejectedValue(new Error('late failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const outer = express();
  outer.use((req, res, next) => { res.flushHeaders(); next(); });
  outer.use(app);
  await expect(request(outer).get('/api/todos')).rejects.toThrow();
  expect(log).not.toHaveBeenCalled();
});
