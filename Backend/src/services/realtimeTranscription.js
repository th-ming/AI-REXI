/**
 * Real-time Transcription Service with Fallback Chain
 * 
 * Fallback chain: Deepgram → AssemblyAI → Gladia → Google → Azure → BYOK
 * Tracks quota per provider, auto-switches on exhaustion
 */

const { Deepgram } = require('@deepgram/sdk');
const { AssemblyAI } = require('assemblyai');
const fetch = require('node-fetch');
const EventEmitter = require('events');

class TranscriptionProvider extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.options = options;
    this.quotaUsed = 0;
    this.quotaLimit = options.quotaLimit || Infinity; // in seconds
    this.isHealthy = true;
    this.lastError = null;
  }

  async checkQuota() {
    return this.quotaUsed < this.quotaLimit;
  }

  addUsage(seconds) {
    this.quotaUsed += seconds;
  }

  getQuotaRemaining() {
    return Math.max(0, this.quotaLimit - this.quotaUsed);
  }

  async startStream(options) {
    throw new Error('Not implemented');
  }

  stopStream() {
    throw new Error('Not implemented');
  }
}

class DeepgramProvider extends TranscriptionProvider {
  constructor(options = {}) {
    super('deepgram', { quotaLimit: 750 * 3600, ...options }); // 750 hours in seconds
    this.client = null;
    this.connection = null;
  }

  async initialize(apiKey) {
    if (!apiKey) throw new Error('Deepgram API key required');
    this.client = new Deepgram(apiKey);
  }

  async startStream({ language = 'vi', model = 'nova-2', interimResults = true, punctuate = true, onTranscript, onError }) {
    if (!this.client) throw new Error('Deepgram not initialized');
    if (!(await this.checkQuota())) throw new Error('Deepgram quota exhausted');

    this.connection = this.client.transcription.live({
      model,
      language,
      interim_results: interimResults,
      punctuate,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    this.connection.on('open', () => {
      this.isHealthy = true;
      console.log('[Deepgram] Connection opened');
    });

    this.connection.on('close', () => {
      console.log('[Deepgram] Connection closed');
    });

    this.connection.on('error', (err) => {
      this.isHealthy = false;
      this.lastError = err.message;
      console.error('[Deepgram] Error:', err.message);
      if (onError) onError(err);
    });

    this.connection.on('transcriptReceived', (data) => {
      const transcript = data?.channel?.alternatives?.[0]?.transcript || '';
      const isFinal = data?.is_final === true;
      const confidence = data?.channel?.alternatives?.[0]?.confidence || 0;

      if (transcript.trim()) {
        this.addUsage(isFinal ? 1 : 0); // Rough estimation
        if (onTranscript) onTranscript({
          text: transcript,
          isFinal,
          confidence,
          provider: 'deepgram',
        });
      }
    });

    return {
      send: (audioData) => {
        if (this.connection && this.connection.getReadyState() === 1) {
          this.connection.send(audioData);
        }
      },
      close: () => {
        if (this.connection) {
          this.connection.finish();
          this.connection = null;
        }
      },
    };
  }

  stopStream() {
    if (this.connection) {
      this.connection.finish();
      this.connection = null;
    }
  }
}

class AssemblyAIProvider extends TranscriptionProvider {
  constructor(options = {}) {
    super('assemblyai', { quotaLimit: 5 * 3600, ...options }); // 5 hours/month
    this.client = null;
    this.realtimeClient = null;
  }

  async initialize(apiKey) {
    if (!apiKey) throw new Error('AssemblyAI API key required');
    this.client = new AssemblyAI({ apiKey });
  }

  async startStream({ language = 'vi', sampleRate = 16000, onTranscript, onError }) {
    if (!this.client) throw new Error('AssemblyAI not initialized');
    if (!(await this.checkQuota())) throw new Error('AssemblyAI quota exhausted');

    // AssemblyAI realtime uses WebSocket
    const { RealtimeClient } = require('assemblyai');
    
    this.realtimeClient = new RealtimeClient({
      apiKey: this.client.apiKey,
      sampleRate,
    });

    this.realtimeClient.on('open', () => {
      this.isHealthy = true;
      console.log('[AssemblyAI] Connection opened');
    });

    this.realtimeClient.on('error', (err) => {
      this.isHealthy = false;
      this.lastError = err.message;
      console.error('[AssemblyAI] Error:', err.message);
      if (onError) onError(err);
    });

    this.realtimeClient.on('close', () => {
      console.log('[AssemblyAI] Connection closed');
    });

    this.realtimeClient.on('transcript', (transcript) => {
      if (transcript.text && onTranscript) {
        this.addUsage(transcript.isFinal ? 1 : 0);
        onTranscript({
          text: transcript.text,
          isFinal: transcript.isFinal,
          confidence: transcript.confidence || 0,
          provider: 'assemblyai',
        });
      }
    });

    await this.realtimeClient.connect();

    return {
      send: (audioData) => {
        if (this.realtimeClient) {
          this.realtimeClient.sendAudio(audioData);
        }
      },
      close: () => {
        if (this.realtimeClient) {
          this.realtimeClient.disconnect();
          this.realtimeClient = null;
        }
      },
    };
  }

  stopStream() {
    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
      this.realtimeClient = null;
    }
  }
}

class GladiaProvider extends TranscriptionProvider {
  constructor(options = {}) {
    super('gladia', { quotaLimit: 10 * 3600, ...options }); // 10 hours/month
    this.apiKey = null;
    this.ws = null;
  }

  async initialize(apiKey) {
    if (!apiKey) throw new Error('Gladia API key required');
    this.apiKey = apiKey;
  }

  async startStream({ language = 'vi', onTranscript, onError }) {
    if (!this.apiKey) throw new Error('Gladia not initialized');
    if (!(await this.checkQuota())) throw new Error('Gladia quota exhausted');

    // Gladia uses WebSocket for real-time
    const WebSocket = require('ws');
    this.ws = new WebSocket('wss://api.gladia.io/v2/live', {
      headers: { 'x-gladia-key': this.apiKey },
    });

    this.ws.on('open', () => {
      this.isHealthy = true;
      // Send config
      this.ws.send(JSON.stringify({
        type: 'configuration',
        language,
        sample_rate: 16000,
        encoding: 'wav',
      }));
      console.log('[Gladia] Connection opened');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'transcript' && msg.text && onTranscript) {
          const isFinal = msg.is_final === true;
          this.addUsage(isFinal ? 1 : 0);
          onTranscript({
            text: msg.text,
            isFinal,
            confidence: msg.confidence || 0,
            provider: 'gladia',
          });
        }
      } catch (e) {
        console.error('[Gladia] Parse error:', e.message);
      }
    });

    this.ws.on('error', (err) => {
      this.isHealthy = false;
      this.lastError = err.message;
      console.error('[Gladia] Error:', err.message);
      if (onError) onError(err);
    });

    this.ws.on('close', () => {
      console.log('[Gladia] Connection closed');
    });

    return {
      send: (audioData) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(audioData);
        }
      },
      close: () => {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      },
    };
  }

  stopStream() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

class FallbackTranscriptionManager {
  constructor() {
    this.providers = [];
    this.currentProvider = null;
    this.providerConfigs = {};
  }

  addProvider(provider, config = {}) {
    this.providers.push(provider);
    this.providerConfigs[provider.name] = config;
  }

  async initializeAll() {
    for (const provider of this.providers) {
      const config = this.providerConfigs[provider.name];
      if (config?.apiKey) {
        try {
          await provider.initialize(config.apiKey);
          console.log(`[Transcription] ${provider.name} initialized`);
        } catch (e) {
          console.error(`[Transcription] ${provider.name} init failed:`, e.message);
        }
      }
    }
  }

  async getAvailableProvider() {
    for (const provider of this.providers) {
      if (provider.isHealthy && await provider.checkQuota()) {
        return provider;
      }
    }
    return null;
  }

  async startStream(options = {}) {
    const provider = await this.getAvailableProvider();
    if (!provider) {
      throw new Error('ALL_FREE_QUOTA_EXHAUSTED → BYOK');
    }

    console.log(`[Transcription] Using provider: ${provider.name}`);
    this.currentProvider = provider;

    return await provider.startStream({
      ...options,
      onTranscript: (data) => {
        if (options.onTranscript) options.onTranscript(data);
      },
      onError: async (err) => {
        provider.isHealthy = false;
        provider.lastError = err.message;
        console.error(`[Transcription] ${provider.name} error:`, err.message);
        
        // Try next provider
        if (options.onError) options.onError(err);
        
        // Auto-fallback
        const nextProvider = await this.getAvailableProvider();
        if (nextProvider && nextProvider !== provider) {
          console.log(`[Transcription] Falling back to: ${nextProvider.name}`);
          this.currentProvider = nextProvider;
          return await nextProvider.startStream(options);
        }
      },
    });
  }

  stopStream() {
    if (this.currentProvider) {
      this.currentProvider.stopStream();
      this.currentProvider = null;
    }
  }

  getStatus() {
    return this.providers.map(p => ({
      name: p.name,
      healthy: p.isHealthy,
      quotaUsed: p.quotaUsed,
      quotaLimit: p.quotaLimit,
      quotaRemaining: p.getQuotaRemaining(),
      lastError: p.lastError,
    }));
  }
}

// Factory function
function createTranscriptionManager(config = {}) {
  const manager = new FallbackTranscriptionManager();

  // Deepgram (primary - most generous free tier)
  if (config.deepgram?.apiKey) {
    const dg = new DeepgramProvider({ quotaLimit: config.deepgram.quotaLimit || 750 * 3600 });
    manager.addProvider(dg, { apiKey: config.deepgram.apiKey });
  }

  // AssemblyAI (fallback 1)
  if (config.assemblyai?.apiKey) {
    const aa = new AssemblyAIProvider({ quotaLimit: config.assemblyai.quotaLimit || 5 * 3600 });
    manager.addProvider(aa, { apiKey: config.assemblyai.apiKey });
  }

  // Gladia (fallback 2)
  if (config.gladia?.apiKey) {
    const gl = new GladiaProvider({ quotaLimit: config.gladia.quotaLimit || 10 * 3600 });
    manager.addProvider(gl, { apiKey: config.gladia.apiKey });
  }

  return manager;
}

module.exports = {
  TranscriptionProvider,
  DeepgramProvider,
  AssemblyAIProvider,
  GladiaProvider,
  FallbackTranscriptionManager,
  createTranscriptionManager,
};