import { Router, Request, Response } from 'express';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export const ttsRouter = Router();

// In-memory LRU-style cache for synthesized MP3 buffers to ensure instant replay
const audioBufferCache = new Map<string, Buffer>();
const MAX_CACHE_ITEMS = 250;

/**
 * GET /api/tts?text=...&role=agent|user
 * Streams high-fidelity Microsoft Azure Neural audio (free, no API key)
 */
ttsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const rawText = (req.query.text as string || '').trim();
    const role = ((req.query.role as string || 'agent').toLowerCase().trim());

    if (!rawText) {
      return res.status(400).json({ success: false, error: 'Query parameter "text" is required.' });
    }

    // Limit maximum text length per turn for performance
    const textToSynthesize = rawText.length > 500 ? rawText.slice(0, 500) : rawText;

    // Agent uses JennyNeural (clean, professional assistant); Vendor uses GuyNeural (authentic contractor tone)
    const voice = (role === 'user' || role === 'vendor')
      ? 'en-US-GuyNeural'
      : 'en-US-JennyNeural';

    const cacheKey = `${voice}:::${textToSynthesize}`;

    // 1. Return cached audio buffer if available
    if (audioBufferCache.has(cacheKey)) {
      const cached = audioBufferCache.get(cacheKey)!;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', cached.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(cached);
    }

    // 2. Synthesize using Microsoft Edge Neural TTS
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(textToSynthesize);
    const chunks: Buffer[] = [];

    audioStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    audioStream.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);

      // Cache the generated MP3
      if (audioBufferCache.size >= MAX_CACHE_ITEMS) {
        const oldestKey = audioBufferCache.keys().next().value;
        if (oldestKey) audioBufferCache.delete(oldestKey);
      }
      audioBufferCache.set(cacheKey, fullBuffer);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', fullBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.send(fullBuffer);
    });

    audioStream.on('error', (streamErr: any) => {
      console.error('[Edge-TTS] Stream error:', streamErr);
      if (!res.headersSent) {
        res.status(502).json({ success: false, error: 'Neural speech synthesis stream failed.' });
      }
    });
  } catch (err: any) {
    console.error('[Edge-TTS] Synthesizer error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Speech synthesis service unavailable.' });
    }
  }
});
