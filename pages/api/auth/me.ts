import type { NextApiRequest, NextApiResponse } from 'next';
import { clearAuthCookie, getAuthUser } from '../../../lib/auth';
import { getDb } from '../../../lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.method === 'DELETE') {
    getDb().prepare('DELETE FROM users WHERE id = ?').run(user.userId);
    clearAuthCookie(res);
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const account = getDb()
    .prepare('SELECT username, email, is_admin FROM users WHERE id = ?')
    .get(user.userId) as { username: string; email: string | null; is_admin: number } | undefined;
  if (!account) return res.status(401).json({ error: 'Account not found' });
  res.status(200).json({
    userId: user.userId,
    username: account.username,
    email: account.email,
    isAdmin: account.is_admin === 1,
  });
}
