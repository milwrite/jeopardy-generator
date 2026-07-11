import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getDb } from '../../../lib/db';
import { signToken, setAuthCookie } from '../../../lib/auth';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  const normalizedLogin = login.trim();
  const db = getDb();
  // Accept username or email
  const user = db
    .prepare('SELECT id, username, email, password_hash, is_admin FROM users WHERE username = ? OR email = ?')
    .get(normalizedLogin, normalizedLogin.toLowerCase()) as
    | { id: number; username: string; email: string | null; password_hash: string; is_admin: number }
    | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isAdmin = user.is_admin === 1;
  const lastLoginAt = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(
    lastLoginAt,
    lastLoginAt,
    user.id,
  );
  const token = signToken({ userId: user.id, username: user.username, isAdmin });
  setAuthCookie(res, token);
  res.status(200).json({
    userId: user.id,
    username: user.username,
    email: user.email,
    isAdmin,
  });
}
