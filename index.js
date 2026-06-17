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

// временная «читалка» аккаунта Amo — показывает менеджеров, воронки и этапы с их ID
app.get('/amo-info', async (req, res) => {
  const base = 'https://' + process.env.AMO_DOMAIN + '/api/v4';
  const headers = { Authorization: 'Bearer ' + process.env.AMO_TOKEN };
  try {
    const usersResp = await fetch(base + '/users', { headers });
    const users = await usersResp.json();

    const pipeResp = await fetch(base + '/leads/pipelines', { headers });
    const pipelines = await pipeResp.json();

    // упрощаем вывод, чтобы было читаемо
    const managers = (users._embedded?.users || []).map(u => ({
      id: u.id, name: u.name, email: u.email
    }));

    const funnels = (pipelines._embedded?.pipelines || []).map(p => ({
      pipeline_id: p.id,
      pipeline_name: p.name,
      statuses: (p._embedded?.statuses || []).map(s => ({ status_id: s.id, status_name: s.name }))
    }));

    res.json({ managers, funnels });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT)))
  .catch((err) => {
    console.error('Не удалось подключиться к базе:', err);
    process.exit(1);
  });
