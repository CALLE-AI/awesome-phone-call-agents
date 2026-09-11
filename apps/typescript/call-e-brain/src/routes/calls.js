import express from 'express';
import { CalleClient } from '@call-e/calle';
import db from '../db.js';

const router = express.Router();
const GUEST_USER_ID = 1;

// ========== FAZER CHAMADA ==========
router.post('/', async (req, res) => {
  const { phone, task, planId } = req.body;
  if (!phone || !task) {
    return res.status(400).json({ error: 'Phone and task are required' });
  }

  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

  try {
    const call = await client.calls.createAndWait({
      recipients: [{ phone }],
      task,
    });

    const stmt = db.prepare(`
      INSERT INTO calls (user_id, plan_id, phone, task, status, result)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      GUEST_USER_ID,
      planId || null,
      phone,
      task,
      call.status || 'completed',
      JSON.stringify(call)
    );

    res.json({ success: true, call });
  } catch (error) {
    console.error('Call error:', error);
    const stmt = db.prepare(`
      INSERT INTO calls (user_id, plan_id, phone, task, status, result)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      GUEST_USER_ID,
      planId || null,
      phone,
      task,
      'failed',
      JSON.stringify({ error: error.message })
    );
    res.status(500).json({ error: error.message || 'Call failed' });
  }
});

// ========== HISTÓRICO (com parse do result) ==========
router.get('/history', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT id, phone, task, status, result, created_at
      FROM calls
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows = stmt.all(GUEST_USER_ID);
    
    // Converter o campo result (string JSON) para objeto
    const calls = rows.map(row => ({
      ...row,
      result: row.result ? JSON.parse(row.result) : null
    }));
    
    res.json(calls);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ========== APAGAR HISTÓRICO ==========
router.delete('/history', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM calls WHERE user_id = ?');
    stmt.run(GUEST_USER_ID);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

export default router;
