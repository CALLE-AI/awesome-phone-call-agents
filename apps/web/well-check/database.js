import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'database.json');

// Initialize database if it doesn't exist
const SEED_PATH = path.join(process.cwd(), 'database.seed.json');
if (!fs.existsSync(DB_PATH)) {
    if (fs.existsSync(SEED_PATH)) {
        fs.copyFileSync(SEED_PATH, DB_PATH);
    } else {
        fs.writeFileSync(DB_PATH, JSON.stringify({ contacts: [], logs: [] }, null, 2));
    }
}

export function getDatabase() {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

export function saveDatabase(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function addLog(logEntry) {
    const db = getDatabase();
    db.logs.unshift({ ...logEntry, timestamp: new Date().toISOString() });
    saveDatabase(db);
}

export function getContacts() {
    return getDatabase().contacts;
}

export function getLogs() {
    return getDatabase().logs;
}
