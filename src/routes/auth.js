import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = Router();
const SALT_ROUNDS = 10;
const COOKIE_NAME = 'auth_token';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
  return /^[\d\s\-+()]{8,}$/.test(phone);
}

router.post('/register', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;

    if (!username?.trim() || !email?.trim() || !phone?.trim() || !password) {
      return res.status(400).json({ error: 'Username, email, phone and password are required.' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!validatePhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.execute(
      'INSERT INTO users (username, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), email.trim(), phone.trim(), hashedPassword, 'USER']
    );

    return res.status(201).json({ message: 'Register success' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Username or email already exists.' });
    }
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username?.trim() || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password, role FROM users WHERE username = ?',
      [username.trim()]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { sub: user.username, role: user.role },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' }
    );

    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    return res.status(200).json({ message: 'Login successful' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  return res.status(200).json({ message: 'Logged out.' });
});

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return res.status(200).json({ username: decoded.sub, role: decoded.role });
  } catch {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
});

export default router;
