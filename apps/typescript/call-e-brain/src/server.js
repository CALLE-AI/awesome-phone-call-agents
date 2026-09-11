import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import plansRoutes from './routes/plans.js';
import callsRoutes from './routes/calls.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Rotas da API
app.use('/api/plans', plansRoutes);
app.use('/api/calls', callsRoutes);

// Ficheiros estáticos (frontend)
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 call-e-brain server running on port ${PORT}`);
});
