// services/chaining.js - Analyzes API requests for dynamic data dependencies and correlation
/**
 * Analyzes intercepted HTTP requests to detect dynamic data dependencies
 * (e.g. Auth tokens from login passed to headers, entity IDs from GET passed into POST bodies).
 * 
 * @param {Array<object>} requests - Sanitized request records
 * @returns {object} Analysis result with detected links and formatted prompt instructions
 */
export function analyzeApiChaining(requests) {
  if (!Array.isArray(requests) || requests.length <= 1) {
    return {
      hasChaining: false,
      links: [],
      chainingSummary: 'Single or independent requests; no multi-step chaining required.'
    };
  }

  const links = [];
  const extractedVariables = [];

  // Pass 1: Catalog variables extracted from responses
  requests.forEach((req, index) => {
    const stepNumber = index + 1;
    const sample = req.responseSample;

    if (sample && typeof sample === 'object') {
      // Check for token / auth properties
      for (const [key, val] of Object.entries(sample)) {
        if (/token|jwt|session|access/i.test(key) && typeof val === 'string') {
          extractedVariables.push({
            step: stepNumber,
            key: key,
            variableName: 'authToken',
            type: 'auth_token',
            value: val,
            source: `${req.method} ${getShortUrl(req.url)}`
          });
        }

        // Check for common primary keys (id, userId, productId, etc.)
        if (/(^id$|_id$|Id$)/i.test(key) && (typeof val === 'number' || typeof val === 'string')) {
          extractedVariables.push({
            step: stepNumber,
            key: key,
            variableName: `${key}`,
            type: 'entity_id',
            value: val,
            source: `${req.method} ${getShortUrl(req.url)}`
          });
        }
      }

      // Check nested objects if products or users array exists
      if (Array.isArray(sample.products) && sample.products.length > 0) {
        const firstProd = sample.products[0];
        if (firstProd && firstProd.id) {
          extractedVariables.push({
            step: stepNumber,
            key: 'products[0].id',
            variableName: 'productId',
            type: 'entity_id',
            value: firstProd.id,
            price: firstProd.price,
            source: `${req.method} ${getShortUrl(req.url)}`
          });
        }
      }
    }
  });

  // Pass 2: Detect if downstream requests use these extracted variables
  requests.forEach((req, toIndex) => {
    const toStep = toIndex + 1;

    extractedVariables.forEach(ext => {
      if (ext.step >= toStep) return; // Can only chain backwards

      // Check 1: Auth Token used in Authorization header
      if (ext.type === 'auth_token') {
        const hasAuthHeader = req.headers?.some(h => 
          h.name.toLowerCase() === 'authorization' || h.name.toLowerCase().includes('token')
        );
        if (hasAuthHeader) {
          links.push({
            fromStep: ext.step,
            toStep: toStep,
            variable: ext.variableName,
            injectedInto: 'Header: Authorization (Bearer Token)',
            fromEndpoint: ext.source,
            toEndpoint: `${req.method} ${getShortUrl(req.url)}`
          });
        }
      }

      // Check 2: Entity ID used in URL path or query params
      if (ext.type === 'entity_id' && ext.value !== undefined) {
        const valStr = String(ext.value);
        if (req.url.includes(`/${valStr}`) || req.url.includes(`=${valStr}`)) {
          links.push({
            fromStep: ext.step,
            toStep: toStep,
            variable: ext.variableName,
            injectedInto: `URL Parameter (${valStr})`,
            fromEndpoint: ext.source,
            toEndpoint: `${req.method} ${getShortUrl(req.url)}`
          });
        }
      }

      // Check 3: Entity ID used in Request Body
      if (req.postData && typeof req.postData === 'object') {
        const postDataStr = JSON.stringify(req.postData);
        if (postDataStr.includes(`"${ext.key}"`) || (ext.value && postDataStr.includes(String(ext.value)))) {
          links.push({
            fromStep: ext.step,
            toStep: toStep,
            variable: ext.variableName,
            injectedInto: 'Payload: JSON Body',
            fromEndpoint: ext.source,
            toEndpoint: `${req.method} ${getShortUrl(req.url)}`
          });
        }
      }
    });
  });

  // Deduplicate links
  const uniqueLinks = [];
  const seen = new Set();
  for (const link of links) {
    const signature = `${link.fromStep}->${link.toStep}:${link.variable}:${link.injectedInto}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      uniqueLinks.push(link);
    }
  }

  // Generate prompt guidance text for Gemini
  let chainingSummary = '';
  if (uniqueLinks.length > 0) {
    chainingSummary = `DETECTED API CHAINING DEPENDENCIES (${uniqueLinks.length} dynamic connections):\n` +
      uniqueLinks.map(l => 
        `- Step ${l.fromStep} (${l.fromEndpoint}) produces [${l.variable}] -> injected into Step ${l.toStep} (${l.toEndpoint}) via ${l.injectedInto}`
      ).join('\n') +
      `\n\nCRITICAL ARCHITECTURAL RULE:
- ALL dependent steps MUST be encapsulated within a SINGLE test case using test.step() (Playwright) or a single scenario function.
- DO NOT use shared module-level mutable variables (let productId;) across multiple separate test() blocks, as Playwright executes tests in parallel workers.
- NO hardcoded fallbacks: never fallback to a hardcoded cart/product ID. If creation fails, fail immediately.
- NO silent skips: never use test.skip(!id) for prerequisites; fail explicitly.`;
  } else {
    chainingSummary = 'Standard independent API calls. Keep each test completely isolated.';
  }

  return {
    hasChaining: uniqueLinks.length > 0,
    links: uniqueLinks,
    extractedVariables,
    chainingSummary
  };
}

function getShortUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.pathname + url.search;
  } catch {
    return urlString;
  }
}

