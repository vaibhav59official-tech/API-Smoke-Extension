// services/gemini.js - Resilient Google Gemini API client with retry, backoff & model fallback

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000; // 2s → 4s → 8s
const TIMEOUT_MS = 45000; // 45s per attempt

/**
 * Fallback model chain. If primary fails after all retries, try the next model.
 */
const MODEL_FALLBACK = {
  'gemini-3.8-flash': 'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview': null
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a single attempt to the Gemini generateContent endpoint.
 */
async function attemptGemini(endpoint, payload, apiKey, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
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
    const err = new Error(`Gemini ${response.status}: ${errorDetail}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];

  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('Empty response from Gemini. Try reducing captured requests or switching models.');
  }

  return candidate.content.parts[0].text;
}

/**
 * Try calling Gemini with retries on a single model.
 * @returns {Promise<string>} Generated text
 * @throws on non-retryable or exhausted retries
 */
async function tryModelWithRetries(apiKey, prompt, model, onStatus) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.15,
      topK: 32,
      topP: 0.92,
      maxOutputTokens: 6144
    }
  };

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
      const result = await attemptGemini(endpoint, payload, apiKey.trim(), controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;

      if (err.name === 'AbortError') {
        lastError = new Error(`${model} timed out after ${TIMEOUT_MS / 1000}s. Retrying...`);
        continue;
      }

      // Non-retryable errors: 400 (bad request), 401 (auth), 403 (forbidden), 404 (model not found)
      if (!RETRYABLE_STATUS.has(err.status)) {
        throw err;
      }
      // 429/500/502/503/504 — retryable, continue loop
    }
  }

  throw lastError || new Error(`${model} failed after ${MAX_RETRIES + 1} attempts.`);
}

/**
 * Calls Gemini with automatic retries and model fallback chain.
 * If the primary model fails, automatically tries the fallback model.
 *
 * @param {string} apiKey - Gemini API Key
 * @param {string} prompt - Formatted prompt
 * @param {string} model - Primary Gemini model ID
 * @param {object} opts
 * @param {Function} opts.onStatus - Optional callback for UI progress messages
 * @returns {Promise<string>}
 */
export async function callGemini(apiKey, prompt, model = 'gemini-3.8-flash', opts = {}) {
  if (!apiKey?.trim()) {
    throw new Error('Gemini API key is required. Please set it in the settings.');
  }

  const { onStatus = () => {} } = opts;

  // Try primary model
  try {
    const result = await tryModelWithRetries(apiKey, prompt, model, onStatus);
    onStatus('✅ Suite generated!');
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

    // No fallback available or non-retryable error
    throw new Error(
      `${primaryError.message}\n\nTip: Click "📊 Generate UI HTML Report" for an instant offline report.`
    );
  }
}
