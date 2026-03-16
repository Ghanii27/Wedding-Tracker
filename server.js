const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data.json');
const USE_PG = !!process.env.DATABASE_URL;

let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

app.use(express.json());
app.use(express.static(__dirname));

// ---- JSON FILE helpers (local dev) ----
function loadFile() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { events: [], india: [], us: [], transactions: [], others: [] }; }
}
function saveFile(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// ---- PG helpers (production) ----
async function initDB() {
  if (!USE_PG) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      category VARCHAR(50) NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('PostgreSQL ready');
}

async function pgGetAll() {
  const result = await pool.query('SELECT id, category, data FROM items ORDER BY id');
  const grouped = { events: [], india: [], us: [], transactions: [], others: [] };
  result.rows.forEach(row => {
    if (grouped[row.category]) grouped[row.category].push({ ...row.data, _id: row.id });
  });
  return grouped;
}

// ---- ROUTES ----

// GET all data
app.get('/api/data', async (req, res) => {
  try {
    if (USE_PG) return res.json(await pgGetAll());
    // Local: add _id as index
    const d = loadFile();
    for (const cat of Object.keys(d)) {
      d[cat] = d[cat].map(function(item, i) { item._id = i; return item; });
    }
    res.json(d);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ADD item
app.post('/api/:category', async (req, res) => {
  try {
    const cat = req.params.category;
    const valid = ['events', 'india', 'us', 'transactions', 'others'];
    if (!valid.includes(cat)) return res.status(400).json({ error: 'Invalid category' });

    if (USE_PG) {
      await pool.query('INSERT INTO items (category, data) VALUES ($1, $2)', [cat, req.body]);
      return res.json(await pgGetAll());
    }
    const d = loadFile();
    d[cat].push(req.body);
    saveFile(d);
    for (const c of Object.keys(d)) d[c] = d[c].map(function(item, i) { item._id = i; return item; });
    res.json(d);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// UPDATE item
app.put('/api/:category/:id', async (req, res) => {
  try {
    const cat = req.params.category;
    // Remove _id from body before saving
    const { _id, ...cleanBody } = req.body;

    if (USE_PG) {
      await pool.query('UPDATE items SET data = $1 WHERE id = $2', [cleanBody, req.params.id]);
      return res.json(await pgGetAll());
    }
    const d = loadFile();
    const idx = parseInt(req.params.id);
    if (d[cat] && idx >= 0 && idx < d[cat].length) d[cat][idx] = cleanBody;
    saveFile(d);
    for (const c of Object.keys(d)) d[c] = d[c].map(function(item, i) { item._id = i; return item; });
    res.json(d);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// DELETE item
app.delete('/api/:category/:id', async (req, res) => {
  try {
    const cat = req.params.category;
    if (USE_PG) {
      await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
      return res.json(await pgGetAll());
    }
    const d = loadFile();
    const idx = parseInt(req.params.id);
    if (d[cat] && idx >= 0 && idx < d[cat].length) d[cat].splice(idx, 1);
    saveFile(d);
    for (const c of Object.keys(d)) d[c] = d[c].map(function(item, i) { item._id = i; return item; });
    res.json(d);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT} (DB: ${USE_PG ? 'PostgreSQL' : 'JSON file'})`));
}).catch(err => { console.error('Init failed:', err); process.exit(1); });
