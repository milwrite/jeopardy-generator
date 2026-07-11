import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthUser } from '../../../lib/auth';
import { getDb } from '../../../lib/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
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
