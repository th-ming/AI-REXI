const express = require('express');
const router = express.Router();
const { createTranscriptionManager } = require('../services/realtimeTranscription');
const { authMiddleware } = require('../middleware/auth.middleware');

// Load provider configs from env/DB
const providerConfigs = {
  deepgram: { apiKey: process.env.DEEPGRAM_API_KEY },
  assemblyai: { apiKey: process.env.ASSEMBLYAI_API_KEY },
  gladia: { apiKey: process.env.GLADIA_API_KEY },
};

// Create transcription manager
const transcriptionManager = createTranscriptionManager({
  deepgram: providerConfigs.deepgram,
  assemblyai: providerConfigs.assemblyai,
  gladia: providerConfigs.gladia,
});

// Initialize providers on startup
transcriptionManager.initializeAll().catch(console.error);

// Helper: Run auth middleware for WebSocket upgrade
function runAuthMiddleware(req, res, next) {
  authMiddleware(req, res, (err) => {
    if (err) {
      req.authError = err;
    }
    next();
  });
}

// WebSocket connection handler for /api/services/transcribe-live
function handleTranscriptionConnection(ws, req) {
  console.log('[Transcribe Live] New connection from user:', req.user?.id);

  let stream = null;

  const sendTranscript = (data) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ type: 'transcript', ...data }));
    }
  };

  const sendError = (message) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message }));
    }
  };

  const sendStatus = (status) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'status', ...status }));
    }
  };

  // Start transcription stream
  let isActive = true;
  (async () => {
    try {
      stream = await transcriptionManager.startStream({
        language: req.query.lang || 'vi',
        onTranscript: sendTranscript,
      });
      sendStatus({ state: 'ready', provider: transcriptionManager.currentProvider?.name });
    } catch (err) {
      sendError(`Failed to start transcription: ${err.message}`);
      ws.close();
      return;
    }
  })();

  // Handle incoming audio data (binary)
  ws.on('message', async (data, isBinary) => {
    if (!isActive || !stream) return;

    try {
      if (isBinary) {
        // Audio data - send to transcription stream
        const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (stream.send) {
          stream.send(audioBuffer);
        }
      } else {
        // Text control message
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'config') {
            if (msg.language) {
              sendStatus({ state: 'config_updated', language: msg.language });
            }
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          // Ignore invalid JSON
        }
      }
    } catch (err) {
      console.error('[Transcribe Live] Send error:', err.message);
      sendError(`Audio send failed: ${err.message}`);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log('[Transcribe Live] Connection closed for user:', req.user?.id);
    isActive = false;
    if (stream?.close) stream.close();
    transcriptionManager.stopStream();
  });

  ws.on('error', (err) => {
    console.error('[Transcribe Live] WS error:', err.message);
    isActive = false;
    if (stream?.close) stream.close();
    transcriptionManager.stopStream();
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'heartbeat' }));
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);

  ws.on('close', () => clearInterval(heartbeat));
}

// REST endpoint to get provider status
router.get('/transcribe-live/status', authMiddleware, (req, res) => {
  res.json({ providers: transcriptionManager.getStatus() });
});

module.exports = { router, handleTranscriptionConnection };