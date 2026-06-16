const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now(),
      data JSONB
    )
  `);
  console.log('Таблица leads готова');
}

app.get('/', (req, res) => {
  res.send('Лид-приёмник работает');
});

app.post('/lead', async (req, res) => {
  try {
    await pool.query('INSERT INTO leads (data) VALUES ($1)', [req.body]);
    console.log('Лид сохранён:', req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка сохранения лида:', err);
    res.status(500).json({ ok: false });
  }
});

app.get('/leads', async (req, res) => {
  const result = await pool.query('SELECT * FROM leads ORDER BY id DESC LIMIT 50');
  res.json(result.rows);
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT)))
  .catch((err) => {
    console.error('Не удалось подключиться к базе:', err);
    process.exit(1);
  });
