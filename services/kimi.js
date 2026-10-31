// services/kimi.js - Resilient Kimi (Moonshot AI) client with retry, backoff & model fallback

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000; // 2s → 4s → 8s
const TIMEOUT_MS = 60000; // 60s per attempt

// Primary and mirror base URLs for Moonshot AI / Kimi
const ENDPOINTS = [
  'https://api.moonshot.ai/v1/chat/completions',
  'https://api.moonshot.cn/v1/chat/completions'
];

/**
 * Fallback model chain. If primary model fails after retries, try the next.
 */
const MODEL_FALLBACK = {
  'kimi-k3': 'kimi-k3.1-pro',
  'kimi-k3.1-pro': 'kimi-k3.1-pro-highspeed',
  'kimi-k3.1-pro-highspeed': 'kimi-k2.7-code',
  'kimi-k2.7-code': null
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a single HTTP attempt to the Kimi chat completions endpoint.
 */
async function attemptKimi(endpoint, payload, apiKey, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => `HTTP ${response.status}`);
    }
    const err = new Error(`Kimi API ${response.status}: ${errorDetail}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from Kimi model. Try reducing captured requests or switching models.');
  }

  return content;
}

/**
 * Try calling Kimi with retries and endpoint failover on a single model.
 */
async function tryModelWithRetries(apiKey, prompt, model, onStatus) {
  const payload = {
    model: model,
    messages: [
      {
        role: 'system',
        content: 'You are an elite Senior SDET. Generate a production-ready, clean, runnable API test suite based on intercepted network traffic.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.15,
    max_tokens: 4096
  };

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Choose endpoint: alternate between global and cn if needed
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];

    if (attempt > 0) {
      const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      onStatus(`⏳ ${model} busy (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${backoffMs / 1000}s...`);
      await sleep(backoffMs);
    } else {
      onStatus(`⚡ Calling ${model}...`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await attemptKimi(endpoint, payload, apiKey, controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      if (err.name === 'AbortError') {
        lastError = new Error(`${model} timed out after ${TIMEOUT_MS / 1000}s. Retrying...`);
        continue;
      }

      // Non-retryable errors: 401 (invalid key), 400 (bad request), 403 (forbidden)
      if (!RETRYABLE_STATUS.has(err.status)) {
        throw err;
      }
      // 429/500/502/503/504 — retryable, loop continues
    }
  }

  throw lastError || new Error(`${model} failed after ${MAX_RETRIES + 1} attempts.`);
}

/**
 * Calls Kimi (Moonshot AI) with automatic retries and model fallback chain.
 *
 * @param {string} apiKey - Kimi / Moonshot API Key (sk-...)
 * @param {string} prompt - Formatted prompt
 * @param {string} model - Kimi model ID (default: 'kimi-k3')
 * @param {object} opts
 * @param {Function} opts.onStatus - Optional callback for UI progress messages
 * @returns {Promise<string>}
 */
export async function callKimi(apiKey, prompt, model = 'kimi-k3', opts = {}) {
  if (!apiKey?.trim()) {
    throw new Error('Kimi API key is required. Get a free key at platform.moonshot.ai.');
  }

  const { onStatus = () => {} } = opts;

  // Try primary model
  try {
    const result = await tryModelWithRetries(apiKey, prompt, model, onStatus);
    onStatus('✅ Suite generated with Kimi!');
    return result;
  } catch (primaryError) {
    // Check if there's a fallback model
    const fallbackModel = MODEL_FALLBACK[model];

    if (fallbackModel && RETRYABLE_STATUS.has(primaryError.status)) {
      onStatus(`⚠️ ${model} unavailable. Falling back to ${fallbackModel}...`);

      try {
        const result = await tryModelWithRetries(apiKey, prompt, fallbackModel, onStatus);
        onStatus(`✅ Suite generated (via ${fallbackModel} fallback)!`);
        return result;
      } catch (fallbackError) {
        throw new Error(
          `Both ${model} and ${fallbackModel} failed.\n` +
          `Primary: ${primaryError.message}\n` +
          `Fallback: ${fallbackError.message}\n\n` +
          `Tip: Click "📊 Generate UI HTML Report" for an instant offline report.`
        );
      }
    }

    // No fallback available or non-retryable error (e.g. 401 invalid key)
    throw new Error(
      `${primaryError.message}\n\nTip: Click "📊 Generate UI HTML Report" for an instant offline report.`
    );
  }
}
