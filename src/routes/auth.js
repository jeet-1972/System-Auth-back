import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db.js';

const router = Router();
const SALT_ROUNDS = 10;
const COOKIE_NAME = 'auth_token';
const COOKIE_OPTS = {
  httpOnly: true,
  // For cross-site requests between frontend and backend domains,
  // SameSite must be 'none' and cookies must be secure.
  secure: true,
  sameSite: 'none',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
  return /^[\d\s\-+()]{8,}$/.test(phone);
}

async function insertUserCompat({ username, email, phone, hashedPassword }) {
  try {
    await pool.execute(
      'INSERT INTO users (username, email, phone, password_hash, role, name) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, phone, hashedPassword, 'USER', username]
    );
    return;
  } catch (err) {
    // Fallback for legacy schemas that still use `password` instead of `password_hash`.
    if (err?.code !== 'ER_BAD_FIELD_ERROR') {
      throw err;
    }
  }

  try {
    await pool.execute(
      'INSERT INTO users (username, email, phone, password, role, name) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, phone, hashedPassword, 'USER', username]
    );
  } catch (err) {
    // Older legacy schema may not include `name`.
    if (err?.code !== 'ER_BAD_FIELD_ERROR') {
      throw err;
    }
    await pool.execute(
      'INSERT INTO users (username, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
      [username, email, phone, hashedPassword, 'USER']
    );
  }
}

async function fetchUserForLoginCompat(username) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, password_hash AS pass_hash, role FROM users WHERE username = ?',
      [username]
    );
    return rows;
  } catch (err) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') {
      throw err;
    }
  }

  const [rows] = await pool.execute(
    'SELECT id, username, password AS pass_hash, role FROM users WHERE username = ?',
    [username]
  );
  return rows;
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

    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    } catch (err) {
      console.error('Password hash error:', err);
      return res.status(500).json({
        error: 'Password hashing failed.',
        step: 'hash',
        code: err?.code || err?.name || 'HASH_ERROR',
      });
    }

    try {
      await insertUserCompat({
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        hashedPassword,
      });
    } catch (err) {
      console.error('Register DB error:', err);
      return res.status(500).json({
        error: 'Database insert failed.',
        step: 'db',
        code: err?.code || err?.name || 'DB_INSERT_ERROR',
      });
    }

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

    let rows;
    try {
      rows = await fetchUserForLoginCompat(username.trim());
    } catch (err) {
      console.error('Login DB error:', err);
      return res.status(500).json({
        error: 'Database lookup failed.',
        step: 'db',
        code: err?.code || err?.name || 'DB_LOOKUP_ERROR',
      });
    }

    const user = rows[0];
    let passwordOk = false;
    if (!user) {
      passwordOk = false;
    } else {
      try {
        passwordOk = await bcrypt.compare(password, user.pass_hash);
      } catch (err) {
        console.error('Password compare error:', err);
        return res.status(500).json({
          error: 'Password compare failed.',
          step: 'hash',
          code: err?.code || err?.name || 'HASH_COMPARE_ERROR',
        });
      }
    }

    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    let token;
    try {
      token = jwt.sign(
        { sub: user.username, role: user.role },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '7d' }
      );
    } catch (err) {
      console.error('JWT sign error:', err);
      return res.status(500).json({
        error: 'JWT generation failed.',
        step: 'jwt',
        code: err?.code || err?.name || 'JWT_SIGN_ERROR',
      });
    }

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
    secure: true,
    sameSite: 'none',
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
