import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { quotesRouter } from './routes/quotes.js';
import { eventsRouter } from './routes/events.js';
import { ttsRouter } from './routes/tts.js';
import { calleService } from './services/calle.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend assets
const publicPath = path.resolve(__dirname, '../../public');
app.use(express.static(publicPath));

// API routes
app.use('/api/quotes', quotesRouter);
app.use('/api/hunt', quotesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tts', ttsRouter);

// Health check, wake ping, and system status endpoint
app.get('/api/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    status: 'online',
    app: 'QuoteHunter',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    calleConfigured: calleService.isLive(),
    calleApiKeyPresent: Boolean(process.env.CALLE_API_KEY),
  });
});

// Fallback for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🏹 QuoteHunter Server running on http://localhost:${PORT}`);
  console.log(`  📡 CALL-E Live Status: ${calleService.isLive() ? 'ACTIVE 🟢' : 'SIMULATION / STANDBY 🟡'}`);
  console.log(`======================================================\n`);
});
