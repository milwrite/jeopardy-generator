import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { BoardInputError, createBoard, listBoards } from '../../../lib/boards';
import { getDb } from '../../../lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const db = getDb();

  try {
    if (req.method === 'GET') {
      return res.status(200).json(listBoards(db, user.userId));
    }

    if (req.method === 'POST') {
      const board = createBoard(db, user.userId, req.body || {});
      return res.status(201).json(board);
    }
  } catch (error) {
    if (error instanceof BoardInputError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Board collection request failed', error);
    return res.status(500).json({ error: 'Board storage is temporarily unavailable.' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
