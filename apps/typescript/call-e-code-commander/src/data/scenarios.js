/**
 * Production Incident Scenarios
 * High-stakes enterprise failures designed to showcase CALL-E's 4-Agent incident response.
 */

export const INCIDENT_SCENARIOS = {
  'fintech-race': {
    id: 'fintech-race',
    title: 'Stripe Webhook Race Condition & Double Billing',
    category: 'FINTECH CRITICAL',
    severity: 'SEV-1 CRITICAL',
    service: 'payment-worker.ts',
    fileName: 'src/services/payment.ts',
    errorCode: 'HTTP 500 / DoubleChargeRisk',
    impact: '4,120 customers affected • $142,000 potential chargeback liability',
    callAlertText: 'Emergency call from payment-worker.ts! Critical concurrency violation detected in Stripe webhook processing. Multiple duplicate ledger debits occurring across concurrent worker nodes.',
    
    stackTrace: `Error: DuplicateChargeViolation: Transaction ID txn_9831 already debited
    at ProcessPaymentWebhook (src/services/payment.ts:42:15)
    at async WorkerPool.dispatch (src/workers/pool.ts:108:7)
    at async WebhookReceiver.handleEvent (src/api/webhooks.ts:54:12)
    -- Concurrent Event Detected: event_id=evt_3M8aJ2901 (Thread #4 & Thread #9) --`,

    rcaReport: {
      rootCause: 'Unprotected non-atomic read-then-write on invoice state without database row locking (FOR UPDATE) or distributed redis lock. When Stripe re-sent webhook event_3M8, two worker threads processed the payload concurrently, bypassing invoice.is_paid check.',
      offendingCommit: 'commit a7b4f91 "Refactor webhook parser to async pipeline" (Merged 2 days ago)',
      vulnerabilityClass: 'CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization (Race Condition)',
      timeToDetect: '4m 12s',
      recommendedFix: 'Implement Redis distributed lock with 15s TTL + PostgreSQL SELECT FOR UPDATE row-level lock and idempotency ledger entry before dispatching capture.'
    },

    originalCode: `import { db } from '../database';
import { stripe } from '../lib/stripe';
import { logger } from '../utils/logger';

// ❌ VULNERABLE: Missing distributed lock and atomic idempotency transaction
export async function processStripeWebhook(event: any) {
  const { id: eventId, data } = event;
  const paymentIntent = data.object;

  logger.info(\`Processing payment webhook: \${eventId}\`);

  // Step 1: Check if invoice was already marked paid
  const invoice = await db.invoices.findOne({
    where: { stripePaymentId: paymentIntent.id }
  });

  if (invoice && invoice.status === 'PAID') {
    logger.warn(\`Invoice \${invoice.id} already paid, ignoring\`);
    return { status: 'skipped' };
  }

  // ⚠️ RACE CONDITION WINDOW:
  // Another concurrent worker thread can read invoice before status updates!
  await new Promise(r => setTimeout(r, 120)); // IO Latency gap

  // Step 2: Charge customer card via external processor
  const charge = await stripe.charges.create({
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    customer: paymentIntent.customer
  });

  // Step 3: Update local database
  await db.invoices.update({
    where: { id: invoice.id },
    data: { status: 'PAID', chargeId: charge.id, paidAt: new Date() }
  });

  return { status: 'success', chargeId: charge.id };
}`,

    patchedCode: `import { db } from '../database';
import { stripe } from '../lib/stripe';
import { redis } from '../lib/redis';
import { logger } from '../utils/logger';

// ✅ PATCHED: Idempotency Key Guard + PostgreSQL SELECT FOR UPDATE Row Locking
export async function processStripeWebhook(event: any) {
  const { id: eventId, data } = event;
  const paymentIntent = data.object;
  const lockKey = \`lock:webhook:payment:\${paymentIntent.id}\`;

  logger.info(\`[Hardened] Processing payment webhook: \${eventId}\`);

  // 1. Acquire Distributed Redis Lock (15s auto-expiration)
  const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', 15);
  if (!acquired) {
    logger.warn(\`Concurrent webhook execution blocked for \${paymentIntent.id}\`);
    return { status: 'concurrency_blocked', retryLater: true };
  }

  try {
    // 2. Atomic Database Transaction with FOR UPDATE Row-Level Lock
    return await db.$transaction(async (tx) => {
      const invoice = await tx.invoices.findUnique({
        where: { stripePaymentId: paymentIntent.id },
        lock: { mode: 'for_update' } // Prevents any second thread from reading
      });

      if (!invoice || invoice.status === 'PAID') {
        logger.info(\`Invoice \${invoice?.id} already marked PAID. Idempotent skip.\`);
        return { status: 'idempotent_skip' };
      }

      // 3. Charge customer with strict Idempotency-Key
      const charge = await stripe.charges.create({
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        customer: paymentIntent.customer
      }, {
        idempotencyKey: \`stripe_charge_\${invoice.id}_\${eventId}\`
      });

      // 4. Update status atomically in same transaction
      await tx.invoices.update({
        where: { id: invoice.id },
        data: { status: 'PAID', chargeId: charge.id, paidAt: new Date() }
      });

      return { status: 'success', chargeId: charge.id };
    });
  } finally {
    await redis.del(lockKey);
  }
}`,

    diff: [
      { type: 'normal', text: " import { db } from '../database';" },
      { type: 'normal', text: " import { stripe } from '../lib/stripe';" },
      { type: 'add', text: "+import { redis } from '../lib/redis';" },
      { type: 'normal', text: " import { logger } from '../utils/logger';" },
      { type: 'normal', text: "" },
      { type: 'del', text: "-// ❌ VULNERABLE: Missing distributed lock and atomic idempotency transaction" },
      { type: 'add', text: "+// ✅ PATCHED: Idempotency Key Guard + PostgreSQL SELECT FOR UPDATE Row Locking" },
      { type: 'normal', text: " export async function processStripeWebhook(event: any) {" },
      { type: 'normal', text: "   const { id: eventId, data } = event;" },
      { type: 'normal', text: "   const paymentIntent = data.object;" },
      { type: 'add', text: "+  const lockKey = `lock:webhook:payment:${paymentIntent.id}`;" },
      { type: 'normal', text: "" },
      { type: 'add', text: "+  // 1. Acquire Distributed Redis Lock (15s auto-expiration)" },
      { type: 'add', text: "+  const acquired = await redis.set(lockKey, 'locked', 'NX', 'EX', 15);" },
      { type: 'add', text: "+  if (!acquired) {" },
      { type: 'add', text: "+    return { status: 'concurrency_blocked', retryLater: true };" },
      { type: 'add', text: "+  }" },
      { type: 'del', text: "-  // Step 1: Check if invoice was already marked paid" },
      { type: 'del', text: "-  const invoice = await db.invoices.findOne({ where: { stripePaymentId: paymentIntent.id } });" },
      { type: 'del', text: "-  if (invoice && invoice.status === 'PAID') return { status: 'skipped' };" },
      { type: 'add', text: "+  try {" },
      { type: 'add', text: "+    return await db.$transaction(async (tx) => {" },
      { type: 'add', text: "+      const invoice = await tx.invoices.findUnique({" },
      { type: 'add', text: "+        where: { stripePaymentId: paymentIntent.id }," },
      { type: 'add', text: "+        lock: { mode: 'for_update' }" },
      { type: 'add', text: "+      });" },
      { type: 'add', text: "+      if (!invoice || invoice.status === 'PAID') return { status: 'idempotent_skip' };" },
      { type: 'del', text: "-  const charge = await stripe.charges.create({ amount: paymentIntent.amount, ... });" },
      { type: 'add', text: "+      const charge = await stripe.charges.create({ ... }, { idempotencyKey: `stripe_${invoice.id}_${eventId}` });" },
      { type: 'add', text: "+      await tx.invoices.update({ where: { id: invoice.id }, data: { status: 'PAID', chargeId: charge.id } });" },
      { type: 'add', text: "+      return { status: 'success', chargeId: charge.id };" },
      { type: 'add', text: "+    });" },
      { type: 'add', text: "+  } finally {" },
      { type: 'add', text: "+    await redis.del(lockKey);" },
      { type: 'add', text: "+  }" },
      { type: 'normal', text: " }" }
    ],

    testSuite: `describe('Stripe Webhook Concurrency Resilience', () => {
  it('should reject concurrent webhook execution without double debiting', async () => {
    const event = { id: 'evt_sim_991', data: { object: { id: 'pi_test_01', amount: 5000, currency: 'usd' } } };
    
    // Simulate 10 simultaneous webhook arrivals
    const results = await Promise.all([
      processStripeWebhook(event),
      processStripeWebhook(event),
      processStripeWebhook(event)
    ]);

    const successes = results.filter(r => r.status === 'success');
    const blockedOrSkipped = results.filter(r => r.status === 'concurrency_blocked' || r.status === 'idempotent_skip');

    expect(successes.length).toBe(1); // Exactly one charge succeeded
    expect(blockedOrSkipped.length).toBe(2); // Others safely blocked
  });
});`
  },

  'ai-pool-exhaust': {
    id: 'ai-pool-exhaust',
    title: 'Vector DB Connection Pool Exhaustion & Memory Leak',
    category: 'AI INFRASTRUCTURE',
    severity: 'SEV-1 CRITICAL',
    service: 'embeddings_worker.py',
    fileName: 'src/vectors/client.py',
    errorCode: 'ERR_POOL_EXHAUSTED / OOMKilled',
    impact: 'Semantic Search Latency > 14,000ms • 18 Pods in CrashLoopBackOff',
    callAlertText: 'Emergency call from embeddings_worker.py! Vector database HTTP connection pool exhausted. 18 search microservices have crashed with out-of-memory errors due to dangling client sessions.',

    stackTrace: `qdrant_client.exceptions.UnexpectedResponse: Connection pool full: Max retries exceeded
    at VectorStore.similarity_search (src/vectors/client.py:68)
    at EmbeddingWorker.process_query (src/workers/embed.py:112)
    RuntimeError: ResourceExhaustion: 5000 unclosed TCP sessions, memory usage 98.4%`,

    rcaReport: {
      rootCause: 'Asynchronous Qdrant/pgvector client instantiated on every request without context manager (`async with`) or singleton pool reuse. Under high query volume, thousands of dangling sockets stay open in TIME_WAIT state, exhausting socket descriptors and triggering Linux OOM killer.',
      offendingCommit: 'commit 3f910a2 "Add dynamic metadata filter to similarity search"',
      vulnerabilityClass: 'CWE-400: Uncontrolled Resource Consumption (Resource Exhaustion)',
      timeToDetect: '2m 45s',
      recommendedFix: 'Refactor Qdrant client to a managed thread-safe singleton connection pool with persistent Keep-Alive and automated graceful session draining.'
    },

    originalCode: `import os
from qdrant_client import QdrantClient

# ❌ VULNERABLE: Instantiating client and unclosed sessions per request
async def search_similar_chunks(query_vector: list, top_k: int = 5):
    # Bug: Creates new unpooled client per query; never closed!
    client = QdrantClient(
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY"),
        timeout=30.0
    )

    results = client.search(
        collection_name="docs_embeddings",
        query_vector=query_vector,
        limit=top_k
    )

    return [{"id": hit.id, "score": hit.score} for hit in results]`,

    patchedCode: `import os
from contextlib import asynccontextmanager
from qdrant_client import AsyncQdrantClient

# ✅ PATCHED: Singleton persistent async connection pool with Keep-Alive
_shared_client = None

def get_vector_client() -> AsyncQdrantClient:
    global _shared_client
    if _shared_client is None:
        _shared_client = AsyncQdrantClient(
            url=os.getenv("QDRANT_URL"),
            api_key=os.getenv("QDRANT_API_KEY"),
            timeout=10.0,
            prefer_grpc=True,
            limits={"max_connections": 100, "max_keepalive_connections": 50}
        )
    return _shared_client

async def search_similar_chunks(query_vector: list, top_k: int = 5):
    client = get_vector_client()
    results = await client.search(
        collection_name="docs_embeddings",
        query_vector=query_vector,
        limit=top_k
    )
    return [{"id": hit.id, "score": hit.score} for hit in results]`,

    diff: [
      { type: 'del', text: "-from qdrant_client import QdrantClient" },
      { type: 'add', text: "+from qdrant_client import AsyncQdrantClient" },
      { type: 'normal', text: "" },
      { type: 'add', text: "+# ✅ PATCHED: Singleton persistent async connection pool with Keep-Alive" },
      { type: 'add', text: "+_shared_client = None" },
      { type: 'add', text: "+def get_vector_client() -> AsyncQdrantClient:" },
      { type: 'add', text: "+    global _shared_client" },
      { type: 'add', text: "+    if _shared_client is None:" },
      { type: 'add', text: "+        _shared_client = AsyncQdrantClient(url=os.getenv('QDRANT_URL'), limits={'max_connections': 100})" },
      { type: 'add', text: "+    return _shared_client" },
      { type: 'del', text: "-    client = QdrantClient(url=os.getenv('QDRANT_URL'), timeout=30.0)" },
      { type: 'add', text: "+    client = get_vector_client()" },
      { type: 'del', text: "-    results = client.search(collection_name='docs_embeddings', ...)" },
      { type: 'add', text: "+    results = await client.search(collection_name='docs_embeddings', ...)" }
    ],

    testSuite: `import pytest
import asyncio
from src.vectors.client import search_similar_chunks

@pytest.mark.asyncio
async def test_high_throughput_vector_pool():
    # Verify 1000 concurrent vector searches do not leak sockets or memory
    tasks = [search_similar_chunks([0.1]*1536, top_k=3) for _ in range(1000)]
    results = await asyncio.gather(*tasks)
    assert len(results) == 1000
    assert all(len(r) > 0 for r in results)`
  },

  'security-sqli': {
    id: 'security-sqli',
    title: 'JWT Algorithm Confusion & SQL Injection in Auth Endpoint',
    category: 'CYBERSECURITY',
    severity: 'SEV-0 CRITICAL BREACH',
    service: 'authController.ts',
    fileName: 'src/controllers/authController.ts',
    errorCode: 'CVE-2026-9102 / SQLi Injection',
    impact: 'Unauthorized Admin Session Hijack Attempt Detected from IP 194.26.29.4',
    callAlertText: 'High priority security call from authController.ts! Zero-day algorithm confusion and raw SQL interpolation detected in token parsing. Malicious payload attempting admin database dump.',

    stackTrace: `SecurityAlert: JWT Verification Bypassed using alg: none
    at verifyToken (src/controllers/authController.ts:24:12)
    at queryUserDatabase (src/controllers/authController.ts:48:9)
    Payload detected: admin' OR '1'='1' --`,

    rcaReport: {
      rootCause: '1) Token verifier fails to enforce RS256 algorithm whitelist, allowing attackers to forge arbitrary tokens using "none" algorithm without a signature. 2) Decoded user ID is concatenated into a raw SQL string query instead of parameterized bindings.',
      offendingCommit: 'commit b10e941 "Quickfix for external SSO token compat"',
      vulnerabilityClass: 'CWE-89: SQL Injection & CWE-347: Improper Verification of Cryptographic Signature',
      timeToDetect: '1m 18s',
      recommendedFix: 'Explicitly enforce `algorithms: ["RS256"]` with public key verification; replace raw string template with parameterized database query with strict UUID format validation.'
    },

    originalCode: `import jwt from 'jsonwebtoken';
import { pool } from '../db';

// ❌ VULNERABLE: Algorithm confusion + Raw SQL Injection
export async function authenticateUser(req: any, res: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  // Flaw 1: Accepts any algorithm without pinning RS256!
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;

  // Flaw 2: Direct SQL concatenation enables injection!
  const query = \`SELECT * FROM users WHERE id = '\${decoded.userId}' AND active = true\`;
  const result = await pool.query(query);

  return res.json({ user: result.rows[0] });
}`,

    patchedCode: `import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { z } from 'zod';

// ✅ PATCHED: Pinned RS256 algorithm + Parameterized query + UUID validator
const UserIdSchema = z.string().uuid();

export async function authenticateUser(req: any, res: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 1. Strictly enforce RS256 public key verification
    const decoded = jwt.verify(token, process.env.JWT_PUBLIC_KEY as string, {
      algorithms: ['RS256'],
      issuer: 'https://auth.company.com'
    }) as { userId: string };

    // 2. Validate user ID format
    const validatedUserId = UserIdSchema.parse(decoded.userId);

    // 3. Safe parameterized query (zero SQL injection vulnerability)
    const result = await pool.query(
      'SELECT id, email, role, created_at FROM users WHERE id = $1 AND active = true',
      [validatedUserId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: result.rows[0] });
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid authentication credentials' });
  }
}`,

    diff: [
      { type: 'add', text: "+import { z } from 'zod';" },
      { type: 'add', text: "+const UserIdSchema = z.string().uuid();" },
      { type: 'normal', text: " export async function authenticateUser(req: any, res: any) {" },
      { type: 'del', text: "-  const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;" },
      { type: 'add', text: "+  const decoded = jwt.verify(token, process.env.JWT_PUBLIC_KEY as string, {" },
      { type: 'add', text: "+    algorithms: ['RS256']," },
      { type: 'add', text: "+    issuer: 'https://auth.company.com'" },
      { type: 'add', text: "+  }) as { userId: string };" },
      { type: 'del', text: "-  const query = `SELECT * FROM users WHERE id = '${decoded.userId}' AND active = true`;" },
      { type: 'del', text: "-  const result = await pool.query(query);" },
      { type: 'add', text: "+  const validatedUserId = UserIdSchema.parse(decoded.userId);" },
      { type: 'add', text: "+  const result = await pool.query(" },
      { type: 'add', text: "+    'SELECT id, email, role FROM users WHERE id = $1 AND active = true'," },
      { type: 'add', text: "+    [validatedUserId]" },
      { type: 'add', text: "+  );" }
    ],

    testSuite: `describe('Auth Endpoint Security Hardening', () => {
  it('should strictly reject algorithm "none" forged tokens', async () => {
    const forgedToken = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJhZG1pbiJ9.';
    const res = await request(app).get('/auth/me').set('Authorization', \`Bearer \${forgedToken}\`);
    expect(res.status).toBe(401);
  });

  it('should neutralize SQL injection attack payloads', async () => {
    const maliciousToken = makeToken({ userId: "admin' OR '1'='1' --" });
    const res = await request(app).get('/auth/me').set('Authorization', \`Bearer \${maliciousToken}\`);
    expect(res.status).toBe(401); // Schema rejection
  });
});`
  }
};
