const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());                                  // разрешаем запросы с Tilda
app.use(express.json());                          // понимаем JSON
app.use(express.urlencoded({ extended: true }));  // и обычные формы

// открыв адрес сервера в браузере, увидишь эту строку — значит, он жив
app.get('/', (req, res) => {
  res.send('Лид-приёмник работает');
});

// сюда форма Tilda будет слать лиды
app.post('/lead', (req, res) => {
  console.log('Получен лид:', req.body);  // пока просто пишем в лог
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
