const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------- Маршрутизация: какой курс → воронка / этап / менеджер ----------
// Ключ course приходит из скрытого поля формы. Потом поправишь под реальные курсы.
const COURSES = {
  'ro-dbt': {
    title: 'RO DBT',
    pipeline_id: 11012062,         // воронка «Воронка»
    status_id: 86549966,           // этап «Первичный контакт»
    responsible_user_id: 3719167,  // Менеджер 1
  },
  'psy-nonpsy': {
    title: 'Психология для непсихологов',
    pipeline_id: 11012062,
    status_id: 86549966,           // «Первичный контакт»
    responsible_user_id: 13933338, // Менеджер 2
  },
};

// Если курс не распознан — лид не теряется, падает сюда.
const DEFAULT_ROUTE = {
  title: 'Заявка с сайта',
  pipeline_id: 11012062,
  status_id: 86549966,             // «Первичный контакт»
  responsible_user_id: 3719167,    // Менеджер 1
};

// ---------- База данных ----------
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

// ---------- Запросы в Amo ----------
async function amo(path, options = {}) {
  const url = 'https://' + process.env.AMO_DOMAIN + '/api/v4' + path;
  const r = await fetch(url, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + process.env.AMO_TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (r.status === 204) return null; // Amo отвечает 204, когда ничего не найдено
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  if (!r.ok) {
    throw new Error('Amo ' + r.status + ': ' + (typeof json === 'string' ? json : JSON.stringify(json)));
  }
  return json;
}

// ищем контакт по телефону, чтобы не плодить дубли
async function findContactIdByPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const res = await amo('/contacts?query=' + encodeURIComponent(digits));
  return res && res._embedded && res._embedded.contacts && res._embedded.contacts[0]
    ? res._embedded.contacts[0].id : null;
}

async function createContact({ name, phone, email, responsible_user_id }) {
  const cf = [];
  if (phone) cf.push({ field_code: 'PHONE', values: [{ value: phone, enum_code: 'WORK' }] });
  if (email) cf.push({ field_code: 'EMAIL', values: [{ value: email, enum_code: 'WORK' }] });
  const body = [{
    name: name || 'Без имени',
    responsible_user_id,
    custom_fields_values: cf.length ? cf : undefined,
  }];
  const res = await amo('/contacts', { method: 'POST', body: JSON.stringify(body) });
  return res._embedded.contacts[0].id;
}

async function createLead({ name, route, contactId }) {
  const body = [{
    name,
    pipeline_id: route.pipeline_id,
    status_id: route.status_id,
    responsible_user_id: route.responsible_user_id,
    _embedded: { contacts: [{ id: contactId }] },
  }];
  const res = await amo('/leads', { method: 'POST', body: JSON.stringify(body) });
  return res._embedded.leads[0].id;
}

async function addNote(leadId, text) {
  const body = [{ note_type: 'common', params: { text } }];
  await amo('/leads/' + leadId + '/notes', { method: 'POST', body: JSON.stringify(body) });
}

// ---------- Главная логика: лид → Amo ----------
async function sendToAmo(lead) {
  const courseKey = String(lead.course || '').trim();
  const route = COURSES[courseKey] || DEFAULT_ROUTE;

  const last = String(lead.last_name || '').trim();
  const first = String(lead.first_name || lead.name || '').trim();
  const personDash = [last, first].filter(Boolean).join('-') || 'Без имени';
  const personSpace = [last, first].filter(Boolean).join(' ') || (lead.name || 'Без имени');

  const dealName = personDash + ' - ' + route.title;

  let contactId = await findContactIdByPhone(lead.phone);
  if (!contactId) {
    contactId = await createContact({
      name: personSpace,
      phone: lead.phone,
      email: lead.email,
      responsible_user_id: route.responsible_user_id,
    });
  }

  const leadId = await createLead({ name: dealName, route, contactId });

  const note = [
    'Заявка с сайта',
    lead.course ? 'Курс: ' + lead.course : null,
    lead.phone ? 'Телефон: ' + lead.phone : null,
    lead.email ? 'Email: ' + lead.email : null,
    lead.roistat_url ? 'Страница: ' + lead.roistat_url : null,
  ].filter(Boolean).join('\n');
  await addNote(leadId, note);

  console.log('Amo OK: сделка', leadId, 'контакт', contactId, '→', dealName);
  return leadId;
}

// ---------- Маршруты ----------
app.get('/', (req, res) => {
  res.send('Лид-приёмник работает');
});

app.post('/lead', async (req, res) => {
  const lead = req.body;
  // 1) сохраняем в базу — это «сейф», лид уже не потеряется
  try {
    await pool.query('INSERT INTO leads (data) VALUES ($1)', [lead]);
    console.log('Лид сохранён в базу:', lead);
  } catch (err) {
    console.error('Ошибка сохранения в базу:', err);
  }
  // 2) сразу отвечаем форме
  res.json({ ok: true });
  // 3) в фоне отправляем в Amo; ошибка здесь не ломает ответ форме
  sendToAmo(lead).catch(err => console.error('Ошибка отправки в Amo:', err.message || err));
});

app.get('/leads', async (req, res) => {
  const result = await pool.query('SELECT * FROM leads ORDER BY id DESC LIMIT 50');
  res.json(result.rows);
});

// временная «читалка» аккаунта Amo
app.get('/amo-info', async (req, res) => {
  try {
    const users = await amo('/users');
    const pipelines = await amo('/leads/pipelines');
    const managers = (users._embedded.users || []).map(u => ({ id: u.id, name: u.name, email: u.email }));
    const funnels = (pipelines._embedded.pipelines || []).map(p => ({
      pipeline_id: p.id,
      pipeline_name: p.name,
      statuses: (p._embedded.statuses || []).map(s => ({ status_id: s.id, status_name: s.name })),
    }));
    res.json({ managers, funnels });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT)))
  .catch((err) => {
    console.error('Не удалось подключиться к базе:', err);
    process.exit(1);
  });
