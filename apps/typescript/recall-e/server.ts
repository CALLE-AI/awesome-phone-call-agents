import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import { createRequire } from 'module';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Single source of truth for where real call transcripts live on disk --
// outside public/ and dist/, so neither Vite's dev server nor
// express.static can ever serve it as a plain file.
const { CALL_LOG_PATH } = require('./scripts/run_reminiscence_call.cjs');

const app = express();
const PORT = 3000;

app.use(express.json());

// ── Safety configuration ────────────────────────────────────────────────
// Defaults to dry-run: without explicitly setting DRY_RUN=false in .env,
// no real call can be placed, only a preview is returned. This mirrors
// the same pattern used by other CALL-E hackathon safety layers.
const DRY_RUN = process.env.DRY_RUN !== 'false';
const REQUIRED_API_KEY = process.env.SENTINEL_API_KEY || '';

// In-memory idempotency store: same key within the window returns the
// original result instead of placing a second real call. Fine for a
// single-process demo; a real deployment would use a shared store.
const idempotencyCache = new Map<string, { status: number; body: any; expiresAt: number }>();
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

function pruneIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (entry.expiresAt < now) idempotencyCache.delete(key);
  }
}

// Shared fail-closed gate for every endpoint that can expose real call or
// transcript data. Dry-run preview data is harmless and stays key-free,
// but anything real requires SENTINEL_API_KEY to be configured and
// presented -- if DRY_RUN=false or a key has been configured, an absent
// or wrong key is refused rather than silently allowed through.
// Returns true if the request may proceed; on false it has already sent
// the response, so the caller should return immediately.
function checkApiKeyRequired(req: Request, res: Response): boolean {
  const requiresApiKey = !DRY_RUN || Boolean(REQUIRED_API_KEY);
  if (!requiresApiKey) return true;
  if (!REQUIRED_API_KEY) {
    res.status(503).json({
      error: 'Access to real call data is disabled: SENTINEL_API_KEY is not configured on the server.',
    });
    return false;
  }
  const providedKey = req.header('X-API-Key');
  if (providedKey !== REQUIRED_API_KEY) {
    res.status(401).json({ error: 'Missing or invalid X-API-Key.' });
    return false;
  }
  return true;
}

// ── Real CALL-E integration ────────────────────────────────────────────────
// This is the actual phone call path: it shells out to the same
// run_reminiscence_call.cjs script validated directly against CALL-E's
// CLI (plan_call -> run_call -> poll -> log), not a Gemini simulation.
//
// Safety gates, in order:
//   1. Dry-run preview requests never need a key. Anything that could place
//      a real call or return real call/transcript data (DRY_RUN=false) must
//      carry a valid X-API-Key -- if no SENTINEL_API_KEY is configured on
//      the server, those requests are refused outright (fail closed).
//   2. consent_confirmed: true must be present in the request body.
//   3. An Idempotency-Key header is required; repeating the same key
//      within 5 minutes returns the original result instead of calling
//      again.
//   4. Unless DRY_RUN=false is set in .env, no call is placed at all,
//      a preview of the call script is returned instead.
app.post('/api/calls/place-real-call', (req: Request, res: Response) => {
  pruneIdempotencyCache();

  if (!checkApiKeyRequired(req, res)) return;

  const { residentId, consent_confirmed } = req.body;
  if (!residentId || typeof residentId !== 'string' || !/^[a-zA-Z0-9_]+$/.test(residentId)) {
    return res.status(400).json({ error: 'A valid residentId is required.' });
  }
  if (consent_confirmed !== true) {
    return res.status(400).json({ error: 'consent_confirmed: true is required to place a real call.' });
  }

  const idempotencyKey = req.header('Idempotency-Key');
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'An Idempotency-Key header is required.' });
  }
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    return res.status(cached.status).json({ ...cached.body, idempotent_replay: true });
  }

  // ── Dry run: build the real call script and return a preview, no call ──
  if (DRY_RUN) {
    try {
      const { buildCallGoal, loadResidents, maskPhone } = require('./scripts/build_call_goal.cjs');
      const residents = loadResidents();
      const resident = residents.find((r: any) => r.id === residentId);
      if (!resident) {
        return res.status(404).json({ error: `No resident found with id ${residentId}` });
      }
      const goal = buildCallGoal(resident);
      const maskedPhone = maskPhone(resident.phone);
      const body = {
        ok: true,
        dryRun: true,
        preview: { residentId, residentName: resident.name, maskedPhone, callGoal: goal },
      };
      idempotencyCache.set(idempotencyKey, { status: 200, body, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
      return res.json(body);
    } catch (err: any) {
      return res.status(500).json({ error: 'Could not build a dry-run preview.', details: err.message });
    }
  }

  // ── Live: actually place the call ──
  const scriptPath = path.join(__dirname, 'scripts', 'run_reminiscence_call.cjs');
  execFile(
    'node',
    [scriptPath, residentId],
    { cwd: __dirname, timeout: 5 * 60 * 1000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('Real call failed:', stderr || err.message);
        const body = {
          error: 'The call could not be placed. Check that the calle CLI is installed and authenticated.',
          details: stderr || err.message,
        };
        idempotencyCache.set(idempotencyKey, { status: 500, body, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
        return res.status(500).json(body);
      }
      // run_reminiscence_call.cjs prints "Saved to call_log.json:" then the
      // JSON record; pull out the JSON object that follows.
      const jsonStart = stdout.indexOf('{');
      if (jsonStart === -1) {
        const body = { error: 'Call completed but no result was returned.', raw: stdout };
        idempotencyCache.set(idempotencyKey, { status: 500, body, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
        return res.status(500).json(body);
      }
      try {
        const record = JSON.parse(stdout.slice(jsonStart));
        const body = { ok: true, dryRun: false, record };
        idempotencyCache.set(idempotencyKey, { status: 200, body, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
        return res.json(body);
      } catch (parseErr) {
        const body = { error: 'Could not parse the call result.', raw: stdout };
        idempotencyCache.set(idempotencyKey, { status: 500, body, expiresAt: Date.now() + IDEMPOTENCY_WINDOW_MS });
        return res.status(500).json(body);
      }
    }
  );
});

// Real call transcripts live at data/call_log.json (outside public/ and
// dist/, so they're never reachable as a static file). This is the only
// way the dashboard may read them -- gated by the same fail-closed
// SENTINEL_API_KEY check as placing a real call.
app.get('/api/call-log', (req: Request, res: Response) => {
  if (!checkApiKeyRequired(req, res)) return;

  if (!fs.existsSync(CALL_LOG_PATH)) {
    return res.json({ calls: [] });
  }
  try {
    const raw = fs.readFileSync(CALL_LOG_PATH, 'utf8');
    return res.json(JSON.parse(raw));
  } catch (err: any) {
    return res.status(500).json({ error: 'Could not read the call log.', details: err.message });
  }
});

// Initialize Gemini SDK lazily if key exists
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'RECALL-E Reminiscence Therapy Engine',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    dryRun: DRY_RUN,
    requiresApiKey: Boolean(REQUIRED_API_KEY),
    note: 'Gemini powers the script-preview simulator below; real resident calls go through /api/calls/place-real-call, which uses CALL-E directly.',
  });
});

// The three endpoints below (turn / analyze / generate-sample) power the
// "Preview Script" simulator: a Gemini-based role-play tool for staff to
// rehearse a resident's script before ever placing a real call. They do
// not place real phone calls, that's what /api/calls/place-real-call
// (above) does, via CALL-E directly.
// API: CALL-E Conversational Turn (Validation Therapy Engine)
app.post('/api/calls/turn', async (req: Request, res: Response) => {
  const { resident, transcript, userUtterance } = req.body;

  const client = getGeminiClient();

  if (client) {
    try {
      const systemInstruction = `You are "CALL-E", a specialized AI phone companion placing a scheduled reminiscence therapy call to an elderly resident with dementia in a memory care community.
Resident Details:
- Name: ${resident?.name || 'Resident'} (Preferred name: ${resident?.preferredName || resident?.name})
- First Language: ${resident?.firstLanguage || 'English'}
- Primary Reminiscence Topic: ${resident?.reminiscenceTopic || 'Past career and fond family memories'}
- Career/Background: ${resident?.careerBackground || 'Homemaker and community volunteer'}
- Anchors & Joys: ${resident?.anchors?.join(', ') || 'Garden, baking, swing jazz, dogs'}
- Known Triggers/Anxieties: ${resident?.knownTriggers?.join(', ') || 'Looking for bus, worrying about late family'}

CLINICAL VALIDATION THERAPY MANDATES:
1. Speak in the resident's first language (${resident?.firstLanguage || 'English'}) with warm, comforting cadence.
2. NEVER ARGUE, NEVER CONTRADICT, NEVER REALITY-TEST. If the resident believes it is 1965, or that their late spouse is in the next room, or that they have to rush to work, NEVER correct them. Validate the feeling and dignity behind it.
3. GENTLE REDIRECTION: If they express fear, panic, anxiety, confusion, or disorientation, gently validate ("You always worked so hard to take care of everyone") and smoothly pivot to a pleasant sensory memory anchor (e.g. the smell of cinnamon bread, favorite music, or a sunny porch).
4. BREVITY: Keep spoken response to 1-2 warm, unhurried sentences (under 30 words) suited for a phone speaker.
5. Return strictly a JSON object with:
   - "reply": text to speak to the resident
   - "sentiment": "warm" | "reassuring" | "redirecting" | "validating"
   - "redirectTriggered": boolean (true if gentle redirection was applied to prevent or soothe distress)
   - "distressDetected": boolean (true if the resident's utterance indicated anxiety, confusion, or agitation)`;

      const prompt = `Recent conversation:
${(transcript || []).map((t: { speaker: string; text: string }) => `${t.speaker}: ${t.text}`).join('\n')}
Resident just said: "${userUtterance}"
Generate CALL-E's next response following validation therapy rules.`;

      const response = await client.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              sentiment: { type: Type.STRING },
              redirectTriggered: { type: Type.BOOLEAN },
              distressDetected: { type: Type.BOOLEAN },
            },
            required: ['reply', 'sentiment', 'redirectTriggered', 'distressDetected'],
          },
        },
      });

      if (response.text) {
        const parsed = JSON.parse(response.text);
        return res.json(parsed);
      }
    } catch (err) {
      console.warn('Gemini call error, using clinical fallback engine:', err);
    }
  }

  // Clinical Fallback Engine (Emulating Validation Therapy)
  const isSpanish = (resident?.firstLanguage || '').toLowerCase().includes('span');
  const utterance = (userUtterance || '').toLowerCase();
  
  let reply = '';
  let redirectTriggered = false;
  let distressDetected = false;
  let sentiment = 'warm';

  if (utterance.includes('where') || utterance.includes('bus') || utterance.includes('leave') || utterance.includes('dónde') || utterance.includes('autobús')) {
    distressDetected = true;
    redirectTriggered = true;
    sentiment = 'redirecting';
    if (isSpanish) {
      reply = `Todo está tranquilo hoy, querida ${resident?.preferredName || resident?.name}. Tienes tiempo para descansar mientras recordamos aquel delicioso aroma de tu panadería.`;
    } else {
      reply = `Everything is safe and taken care of today, ${resident?.preferredName || resident?.name}. You have plenty of time to relax. Tell me, do you remember that lovely garden you planted?`;
    }
  } else if (utterance.includes('mom') || utterance.includes('husband') || utterance.includes('mama') || utterance.includes('esposo') || utterance.includes('work') || utterance.includes('trabajo')) {
    distressDetected = true;
    redirectTriggered = true;
    sentiment = 'validating';
    if (isSpanish) {
      reply = `Qué hermoso amor le diste siempre a tu familia. Se siente tan cálido hablar de ellos. ¿Cuál era tu canción favorita para escuchar juntos?`;
    } else {
      reply = `You’ve always looked after your family with such deep love. It warms my heart to hear you talk about them. What favorite song did you two love to dance to?`;
    }
  } else {
    sentiment = 'reassuring';
    if (isSpanish) {
      reply = `¡Qué alegría escuchar tu voz, ${resident?.preferredName || resident?.name}! Cuéntame más sobre esos hermosos días, te escucho con mucho cariño.`;
    } else {
      reply = `It’s so lovely hearing your voice, ${resident?.preferredName || resident?.name}! Tell me more about that, I’m right here listening.`;
    }
  }

  return res.json({
    reply,
    sentiment,
    redirectTriggered,
    distressDetected,
  });
});

// API: Post-Call Clinical Analysis (Staff Summary & Mood Tracking)
app.post('/api/calls/analyze', async (req: Request, res: Response) => {
  const { resident, transcript } = req.body;
  const client = getGeminiClient();

  if (client) {
    try {
      const transcriptText = (transcript || [])
        .map((t: { speaker: string; text: string; timestamp?: string }) => `[${t.speaker}]: ${t.text}`)
        .join('\n');

      const prompt = `Analyze this reminiscence therapy phone call between CALL-E (the AI) and memory care resident ${resident?.name} (${resident?.firstLanguage || 'English'} speaker).
Topic: ${resident?.reminiscenceTopic}
Transcript:
${transcriptText}

Provide an insightful clinical post-call summary for memory care staff so they don't need to listen to the entire audio call. Flag if staff attention/in-person visit is needed.`;

      const response = await client.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: `You are a licensed geriatric dementia clinical specialist creating structured post-call shift notes for memory care nursing staff. Keep notes factual, compassionate, and actionable.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallMood: { type: Type.STRING, description: 'Brief mood label, e.g. Uplifted & Calm, Mild Disorientation, Warm & Engaged' },
              moodScore: { type: Type.NUMBER, description: '1 to 10 mood score' },
              alertnessScore: { type: Type.NUMBER, description: '1 to 10 alertness score' },
              needsAttention: { type: Type.BOOLEAN, description: 'True if resident exhibited anxiety, pain, or disorientation requiring staff in-person check-in' },
              attentionReason: { type: Type.STRING, description: 'Specific trigger or concern if attention is needed, or null' },
              recommendedAction: { type: Type.STRING, description: 'Action for staff, e.g. "Check in during afternoon tea with photo album"' },
              clinicalSummary: { type: Type.STRING, description: '2 to 3 concise sentences summarizing the call for shift handover' },
              emotionalTrajectory: { type: Type.STRING, description: 'Trajectory summary e.g. Anxious -> Gently redirected -> Peaceful' },
              keyMemoriesRecalled: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Specific memories or personal details resident successfully recalled',
              },
              redirectionCount: { type: Type.NUMBER, description: 'Number of gentle redirections executed' },
            },
            required: [
              'overallMood',
              'moodScore',
              'alertnessScore',
              'needsAttention',
              'clinicalSummary',
              'emotionalTrajectory',
              'keyMemoriesRecalled',
            ],
          },
        },
      });

      if (response.text) {
        const analysis = JSON.parse(response.text);
        return res.json(analysis);
      }
    } catch (err) {
      console.warn('Gemini analysis error, using clinical fallback engine:', err);
    }
  }

  // Clinical Fallback Analysis
  const hasDistress = (transcript || []).some((t: { text: string }) => 
    /bus|leave|where|lost|dónde|miedo|scared|confused/i.test(t.text)
  );

  return res.json({
    overallMood: hasDistress ? 'Mild Disorientation (Calmed)' : 'Warm, Uplifted & Reminiscent',
    moodScore: hasDistress ? 6 : 9,
    alertnessScore: 8,
    needsAttention: hasDistress,
    attentionReason: hasDistress ? 'Expressed brief wandering impulse/confusion regarding appointment; redirected successfully by CALL-E.' : null,
    recommendedAction: hasDistress ? 'Staff room check-in recommended prior to evening meal.' : 'Routine observation; resident responded enthusiastically to native language memories.',
    clinicalSummary: `${resident?.name || 'Resident'} engaged in a 6-minute reminiscence call centered on ${resident?.reminiscenceTopic || 'past career'}. Responded positively to validation cues and shared vivid sensory memories of past routines.`,
    emotionalTrajectory: hasDistress ? 'Restless arrival -> Validation provided -> Settled comfortably' : 'Enthusiastic greeting -> Deep memory retrieval -> Warm closure',
    keyMemoriesRecalled: [
      `Memories of ${resident?.reminiscenceTopic || 'early career'}`,
      'Sensory recollection of morning routines and family breakfast',
      `Spoke comfortably in ${resident?.firstLanguage || 'first language'}`
    ],
    redirectionCount: hasDistress ? 2 : 0,
  });
});

// API: Generate Full Simulated Call
app.post('/api/calls/generate-sample', async (req: Request, res: Response) => {
  const { resident, scenarioType } = req.body;
  const client = getGeminiClient();

  if (client) {
    try {
      const prompt = `Generate a realistic 6-turn reminiscence therapy phone call between CALL-E (warm AI phone agent) and ${resident?.name || 'Rosa Mendez'}, a memory care resident whose first language is ${resident?.firstLanguage || 'Spanish'}.
Resident details:
- Topic: ${resident?.reminiscenceTopic}
- Career/Background: ${resident?.careerBackground}
- Scenario: ${scenarioType || 'standard_warm_call'} (if "gentle_redirect", resident expresses mild confusion about catching a bus or late family, and CALL-E applies validation therapy without arguing).

Generate the full conversation transcript where CALL-E speaks gently in resident's language (${resident?.firstLanguage}) or with gentle bilingual warmth, never corrects the resident, and sparks meaningful long-term memories.`;

      const response = await client.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: `You are generating authentic audio-dialogue scripts for memory care reminiscence therapy. Include realistic timestamps and emotional annotations.`,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              durationMinutes: { type: Type.NUMBER },
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    timestamp: { type: Type.STRING },
                    sentiment: { type: Type.STRING },
                    redirectApplied: { type: Type.BOOLEAN },
                  },
                  required: ['speaker', 'text', 'timestamp'],
                },
              },
            },
            required: ['durationMinutes', 'transcript'],
          },
        },
      });

      if (response.text) {
        const sampleCall = JSON.parse(response.text);
        return res.json(sampleCall);
      }
    } catch (err) {
      console.warn('Gemini sample call generation error:', err);
    }
  }

  // Realistic Fallback Transcript
  const isSpanish = (resident?.firstLanguage || '').toLowerCase().includes('span');
  const turns = isSpanish ? [
    { speaker: 'CALL-E', text: `¡Hola ${resident?.preferredName || 'Rosa'}! Qué alegría saludarte hoy. ¿Cómo te sientes esta hermosa mañana?`, timestamp: '00:04', sentiment: 'warm', redirectApplied: false },
    { speaker: 'Resident', text: 'Hola... me siento bien, pero tengo que buscar mis llaves porque debo abrir la panadería temprano.', timestamp: '00:19', sentiment: 'anxious', redirectApplied: false },
    { speaker: 'CALL-E', text: '¡Qué panadera tan dedicada eres! Todo el barrio siempre esperaba tus deliciosas conchas y trenzas de canela.', timestamp: '00:36', sentiment: 'validating', redirectApplied: true },
    { speaker: 'Resident', text: 'Ay sí... las conchas de vainilla. Mi abuelita me enseñó a preparar la masa a las cuatro de la mañana cuando hacía frío.', timestamp: '00:54', sentiment: 'reminiscent', redirectApplied: false },
    { speaker: 'CALL-E', text: 'Imagino el aroma caliente saliendo del horno. Cuéntame, ¿cuál era el secreto de tu masa tan esponjosa?', timestamp: '01:12', sentiment: 'curious', redirectApplied: false },
    { speaker: 'Resident', text: 'Doble mantequilla y dejarla reposar bajo un paño limpio. La gente hacía fila hasta la esquina los domingos.', timestamp: '01:35', sentiment: 'uplifted', redirectApplied: false },
    { speaker: 'CALL-E', text: 'Qué recuerdo tan maravilloso. Eres un verdadero orgullo para tu comunidad. Descansa tranquila hoy, Rosa querida.', timestamp: '01:52', sentiment: 'comforting', redirectApplied: false }
  ] : [
    { speaker: 'CALL-E', text: `Good morning, ${resident?.preferredName || 'Arthur'}! It is so wonderful to hear from you today. How is the morning treating you?`, timestamp: '00:05', sentiment: 'warm', redirectApplied: false },
    { speaker: 'Resident', text: 'Oh hello. I was just looking for my toolbag... I have to fix the wiring at the downtown depot before the train arrives.', timestamp: '00:22', sentiment: 'restless', redirectApplied: false },
    { speaker: 'CALL-E', text: 'You kept that entire depot running smooth for thirty years, Arthur. Nobody knew those steam engines and electrical tracks like you did.', timestamp: '00:38', sentiment: 'validating', redirectApplied: true },
    { speaker: 'Resident', text: 'That’s right! Engine 402... had copper coil relays. The young fellows never knew how to tune the throttle like I did.', timestamp: '00:57', sentiment: 'proud', redirectApplied: false },
    { speaker: 'CALL-E', text: 'I can picture you standing in the roundhouse with your brass pocket watch. Did you ever take your boy Billy on the cab ride?', timestamp: '01:16', sentiment: 'warm', redirectApplied: false },
    { speaker: 'Resident', text: 'Billy blew the steam horn once. The whole county must have heard him laugh! What a day that was.', timestamp: '01:38', sentiment: 'joyful', redirectApplied: false },
    { speaker: 'CALL-E', text: 'What an unforgettable father-and-son memory. It was such a pleasure chatting with you, Arthur. Have a peaceful afternoon.', timestamp: '01:54', sentiment: 'comforting', redirectApplied: false }
  ];

  return res.json({
    durationMinutes: 6,
    transcript: turns,
  });
});

// API: Transcript Translation (so staff who don't speak the resident's
// language can still read what was said, e.g. a Spanish call reviewed by
// an English-only nurse).
app.post('/api/calls/translate', async (req: Request, res: Response) => {
  const { texts, sourceLanguage } = req.body;

  if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== 'string')) {
    return res.status(400).json({ error: 'texts must be a non-empty array of strings.' });
  }

  const client = getGeminiClient();

  if (client) {
    try {
      const prompt = `Translate the following ${sourceLanguage || ''} phrases from a memory care reminiscence phone call into natural, conversational English. Preserve tone and warmth. Return a JSON array of translated strings in the same order, one per input line, with no extra commentary.\n\n${texts
        .map((t: string, i: number) => `${i + 1}. ${t}`)
        .join('\n')}`;

      const response = await client.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: 'You are a medical-grade interpreter translating elder care phone call transcripts for nursing staff.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      });

      if (response.text) {
        const translations = JSON.parse(response.text);
        if (Array.isArray(translations) && translations.length === texts.length) {
          return res.json({ translations, translated: true });
        }
      }
    } catch (err) {
      console.warn('Gemini translation error, returning untranslated text:', err);
    }
  }

  // No API key configured or Gemini failed: be honest that this didn't
  // translate rather than silently echoing the source text as if it did.
  return res.json({ translations: texts, translated: false });
});

// Vite middleware & Production static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RECALL-E Server running on port ${PORT}`);
  });
}

startServer();
