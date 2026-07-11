import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import {
  BoardConflictError,
  BoardInputError,
  deleteBoard,
  getBoard,
  updateBoard,
} from '../../../lib/boards';
import { getDb } from '../../../lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid board id' });
  }

  const db = getDb();

  try {
    if (req.method === 'GET') {
      const board = getBoard(db, user.userId, id, true);
      return board
        ? res.status(200).json(board)
        : res.status(404).json({ error: 'Board not found' });
    }

    if (req.method === 'PUT' || req.method === 'PATCH') {
      const board = updateBoard(db, user.userId, id, req.body || {});
      return board
        ? res.status(200).json(board)
        : res.status(404).json({ error: 'Board not found' });
    }

    if (req.method === 'DELETE') {
      return deleteBoard(db, user.userId, id)
        ? res.status(200).json({ ok: true })
        : res.status(404).json({ error: 'Board not found' });
    }
  } catch (error) {
    if (error instanceof BoardConflictError) {
      return res.status(error.status).json({ error: error.message, current: error.current });
    }
    if (error instanceof BoardInputError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Board request failed', error);
    return res.status(500).json({ error: 'Board storage is temporarily unavailable.' });
  }

  res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}
