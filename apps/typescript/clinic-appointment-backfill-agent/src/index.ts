import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import appointments from './routes/appointments';
import webhooks from './routes/webhooks';
import dashboard from './routes/dashboard';
import inbound from './routes/inbound';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const publicCandidates = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'src', 'public'),
  path.join(process.cwd(), 'src', 'public'),
];
const publicDir = publicCandidates.find((candidate) => fs.existsSync(candidate)) || publicCandidates[0];
const dashboardFile = [
  path.join(publicDir, 'dashboard.html'),
  path.join(__dirname, 'dashboard.html'),
  path.join(process.cwd(), 'src', 'public', 'dashboard.html'),
].find((candidate) => fs.existsSync(candidate)) || path.join(publicDir, 'dashboard.html');

app.use(cors());
app.use(bodyParser.json());
app.use('/public', express.static(publicDir));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'Clinic Appointment Backfill Agent' });
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'Please Check ReadMe.md' });
});

app.get('/dashboard', (_req: Request, res: Response) => {
  res.sendFile(dashboardFile);
});

app.use('/api/appointments', appointments);
app.use('/api/webhooks', webhooks);
app.use('/api/inbound', inbound);
app.use('/api/dashboard', dashboard);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
