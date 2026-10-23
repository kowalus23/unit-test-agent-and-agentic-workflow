import express from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../src/core/database.ts';
import { createHealthRouter } from '../src/api/health.ts';
import { record } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const database = createDatabase('postgresql://test:test@127.0.0.1:1/test');
  const app = express();
  app.use('/api', createHealthRouter(database));
  return { app, database };
}

it('reports ok when the database answers', async () => {
  const { app, database } = setup();
  const findFirst = vi.spyOn(database.todo, 'findFirst').mockResolvedValue(record);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledOnce();
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('reports ok when there are no tasks', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockResolvedValue(null);
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});

it('reports unavailable with 503 when the database fails', async () => {
  const { app, database } = setup();
  vi.spyOn(database.todo, 'findFirst').mockRejectedValue(new Error('connection refused'));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'unavailable' });
  expect(response.text).not.toContain('connection refused');
});
