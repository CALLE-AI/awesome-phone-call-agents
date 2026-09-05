import express from 'express';
import db from '../db.js';

const router = express.Router();
const GUEST_USER_ID = 1;

// ========== CRIAR PLANO ==========
router.post('/', (req, res) => {
  const { name, phone, task } = req.body;
  if (!name || !phone || !task) {
    return res.status(400).json({ error: 'Name, phone, and task are required' });
  }
  const stmt = db.prepare(
    'INSERT INTO plans (user_id, name, phone, task) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(GUEST_USER_ID, name, phone, task);
  res.json({ id: info.lastInsertRowid, name, phone, task });
});

// ========== LISTAR PLANOS ==========
router.get('/', (req, res) => {
  const stmt = db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC');
  const plans = stmt.all(GUEST_USER_ID);
  res.json(plans);
});

// ========== EDITAR PLANO ==========
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { name, phone, task } = req.body;
  
  if (!name || !phone || !task) {
    return res.status(400).json({ error: 'Name, phone, and task are required' });
  }

  // Verificar se o plano existe e pertence ao utilizador
  const checkStmt = db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?');
  const existing = checkStmt.get(id, GUEST_USER_ID);
  if (!existing) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const updateStmt = db.prepare(
    'UPDATE plans SET name = ?, phone = ?, task = ? WHERE id = ? AND user_id = ?'
  );
  const info = updateStmt.run(name, phone, task, id, GUEST_USER_ID);
  
  if (info.changes === 0) {
    return res.status(500).json({ error: 'Failed to update plan' });
  }

  res.json({ id: parseInt(id), name, phone, task });
});

// ========== ELIMINAR PLANO (opcional) ==========
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM plans WHERE id = ? AND user_id = ?');
  const info = stmt.run(id, GUEST_USER_ID);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  res.json({ success: true });
});

export default router;
