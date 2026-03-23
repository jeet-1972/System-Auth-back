import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 26578,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'USER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name VARCHAR(255) NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id)
  )
`;

export async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query(CREATE_USERS_TABLE);
    // Best-effort compatibility migrations for existing legacy schemas.
    const tryQuery = async (sql) => {
      try {
        await conn.query(sql);
      } catch (err) {
        // Ignore unsupported syntax for IF NOT EXISTS and duplicate-column cases.
        const ignorable = ['ER_DUP_FIELDNAME', 'ER_PARSE_ERROR', 'ER_BAD_FIELD_ERROR'];
        if (!ignorable.includes(err?.code)) {
          throw err;
        }
      }
    };

    await tryQuery('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL');
    await tryQuery("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'USER'");
    await tryQuery('ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP');
    await tryQuery('ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255) NULL');
    await tryQuery(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'
    );
    // If a legacy `password` column exists, backfill password_hash once.
    await tryQuery('UPDATE users SET password_hash = password WHERE password_hash IS NULL AND password IS NOT NULL');
  } finally {
    conn.release();
  }
}

export default pool;
