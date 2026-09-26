const express = require('express');
const path = require('path');
const { invoke, activityLog } = require('./invoke');
const store = require('./store');
const { tools } = require('./tools');
const { maskDeep } = require('./mask');
const { localOnlyMiddleware } = require('./local-only');
const { getProvider } = require('./providers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(localOnlyMiddleware);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/state', (req, res) => {
  res.json(maskDeep(store.getState()));
});

app.get('/api/activity-log', (req, res) => {
  res.json(maskDeep(activityLog.getAll()));
});

app.get('/api/tasks', (req, res) => {
  res.json(maskDeep(store.listTasks()));
});

app.post('/api/invoke', async (req, res) => {
  try {
    // No silent default: a caller that omits `actor` gets nothing, never the most
    // privileged identity. The dashboard's own fetch() always sends `actor: 'owner'`
    // explicitly (public/index.html) — this is deliberate friction for anything else.
    const { tool, args, actor } = req.body;
    if (!tool) {
      return res.status(400).json({ error: 'tool required' });
    }
    if (!actor) {
      return res.status(400).json({ error: 'actor required' });
    }
    const result = await invoke(tool, args || {}, actor);
    res.json(maskDeep(result));
  } catch (error) {
    // An error message is display text like any other response field.
    res.status(500).json(maskDeep({ error: error.message }));
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

// Exported so tests can drive the real Express app over a real (ephemeral, loopback)
// socket instead of only calling invoke() in-process — the HTTP layer itself (this
// file) is where local-only enforcement and the actor-required check actually live.
module.exports = { app };

if (require.main === module) {
  // invoke.js builds the provider per call; building the real one once here as well means a
  // bad CALLE_BASE_URL, allowlist entry, or key format stops the server at startup instead
  // of surfacing on the owner's first approved call. The messages never carry the values.
  const providerName = process.env.CALL_PROVIDER || 'fake';
  if (providerName !== 'fake') {
    try {
      getProvider(providerName);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Refusing to start: ${error.message}`);
      process.exit(1);
    }
  }
  app.listen(PORT, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`CALL-E dashboard server listening on http://localhost:${PORT} (local only)`);
  });
}
