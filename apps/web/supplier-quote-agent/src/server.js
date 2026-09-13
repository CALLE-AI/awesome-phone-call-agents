const express = require('express');
const path = require('path');
const { invoke, activityLog } = require('./invoke');
const store = require('./store');
const { tools } = require('./tools');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/state', (req, res) => {
  res.json(store.getState());
});

app.get('/api/activity-log', (req, res) => {
  res.json(activityLog.getAll());
});

app.get('/api/tasks', (req, res) => {
  res.json(store.listTasks());
});

app.post('/api/invoke', async (req, res) => {
  try {
    const { tool, args, actor = 'owner' } = req.body;
    if (!tool) {
      return res.status(400).json({ error: 'tool required' });
    }
    const result = await invoke(tool, args || {}, actor);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tools', (req, res) => {
  const toolDescriptions = tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  }));
  res.json(toolDescriptions);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CALL-E dashboard server listening on http://localhost:${PORT}`);
});
