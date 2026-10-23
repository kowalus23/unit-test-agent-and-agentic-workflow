import { Router } from 'express';
import type { Database } from '../features/todos/types.js';

export function createHealthRouter(database: Database) {
  const router = Router();
  router.get('/health', async (req, res) => {
    try {
      await database.todo.findFirst({ select: { id: true } });
    } catch {
      // Health checks must report the dependency state, not a generic server error.
      res.status(503).json({ status: 'unavailable' });
      return;
    }
    res.json({ status: 'ok' });
  });
  return router;
}
