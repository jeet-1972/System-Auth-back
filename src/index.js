import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Allow credentials and dynamically reflect the requesting origin.
// This avoids CORS issues when frontend is deployed on a different domain.
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.use('/api', authRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

async function start() {
  try {
    await initDb();
    console.log('Database initialized.');
  } catch (err) {
    console.error('Database init failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
