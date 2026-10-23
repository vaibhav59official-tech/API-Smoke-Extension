// services/sanitizer.js - Masks sensitive credentials and compacts payloads for AI synthesis

const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'cookie',
  'set-cookie'
];
const SENSITIVE_FIELDS = /(?:access.?token|refresh.?token|auth(?:orization)?|api.?key|secret|password|session|cookie)/i;

function redactSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1{{REDACTED}}')
      .replace(/((?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&\s,]+/gi, '$1{{REDACTED}}');
  }
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_FIELDS.test(key) ? '{{REDACTED}}' : redactSensitiveFields(item)
  ]));
}

/**
 * Sanitizes headers by replacing real credentials with placeholder variables.
 * @param {Array<{name: string, value: string}>} headers
 * @returns {Array<{name: string, value: string}>}
 */
export function sanitizeHeaders(headers) {
  if (!Array.isArray(headers)) return [];

  return headers.map(header => {
    const lowerName = header.name.toLowerCase();
    
    if (lowerName === 'authorization') {
      if (header.value.toLowerCase().startsWith('bearer ')) {
        return { name: header.name, value: 'Bearer {{AUTH_TOKEN}}' };
      }
      return { name: header.name, value: '{{AUTH_HEADER_VALUE}}' };
    }

    if (lowerName === 'cookie') {
      return { name: header.name, value: '{{SESSION_COOKIES}}' };
    }

    if (SENSITIVE_HEADERS.includes(lowerName)) {
      return { name: header.name, value: `{{${header.name.toUpperCase().replace(/-/g, '_')}}}` };
    }

    return header;
  });
}

/**
 * Compacts JSON to keep prompt size minimal.
 * maxDepth controls how deep we recurse (1 for GraphQL, 2 for normal).
 * maxKeys limits how many keys we keep per object.
 */
function compactSample(data, depth = 0, maxDepth = 2, maxKeys = 8) {
  if (depth >= maxDepth || data === null || data === undefined) {
    if (typeof data === 'string' && data.length > 60) return data.slice(0, 60) + '...';
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return [];
    return [compactSample(data[0], depth + 1, maxDepth, maxKeys), `...(${data.length - 1} more)`];
  }

  if (typeof data === 'object') {
    const compacted = {};
    const entries = Object.entries(data);
    const limit = Math.min(entries.length, maxKeys);
    for (let i = 0; i < limit; i++) {
      const [key, val] = entries[i];
      if (typeof val === 'string' && val.length > 60) {
        compacted[key] = val.slice(0, 60) + '...';
      } else if (Array.isArray(val)) {
        compacted[key] = val.length === 0 ? [] : [compactSample(val[0], depth + 1, maxDepth, maxKeys), `...(${val.length - 1} more)`];
      } else if (typeof val === 'object' && val !== null) {
        compacted[key] = compactSample(val, depth + 1, maxDepth, maxKeys);
      } else {
        compacted[key] = val;
      }
    }
    if (entries.length > limit) {
      compacted['...'] = `(${entries.length - limit} more keys)`;
    }
    return compacted;
  }

  return data;
}

/**
 * Detects if a URL is a GraphQL endpoint.
 */
function isGraphQL(url, postData) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes('/graphql') || path.endsWith('/gql')) return true;
  } catch {}
  // Also check if postData has query field (typical GraphQL)
  if (postData && typeof postData === 'object' && ('query' in postData || 'operationName' in postData)) {
    return true;
  }
  return false;
}

/**
 * Extracts GraphQL operation name from postData.
 */
export function extractGraphQLOperationName(postData) {
  if (!postData || typeof postData !== 'object') return null;
  if (postData.operationName) return postData.operationName;
  // Try to extract from query string
  const query = postData.query;
  if (typeof query === 'string') {
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Clean and compact a captured request into a minimal representation for the LLM.
 * @param {object} req - DevTools network request
 * @param {string} responseBody - The text content of the response
 * @returns {object}
 */
export function buildSanitizedRequestRecord(req, responseBody = '') {
  const url = req.request.url;
  let method = (req.request.method || 'GET').toUpperCase();
  // Normalize non-standard HTTP methods
  if (method === 'QUERY') method = 'GET';

  const headers = sanitizeHeaders(req.request.headers || []);
  
  let rawPostData = null;
  if (req.request.postData?.text) {
    try {
      rawPostData = JSON.parse(req.request.postData.text);
    } catch {
      rawPostData = req.request.postData.text.slice(0, 150);
    }
  }

  // Detect GraphQL and extract operation name
  const gql = isGraphQL(url, rawPostData);
  const operationName = gql ? extractGraphQLOperationName(rawPostData) : null;

  // Compact postData — for GraphQL, strip the query string to just the operation name
  let postData = null;
  if (rawPostData && typeof rawPostData === 'object') {
    if (gql) {
      // For GraphQL: keep only operationName and variables (no raw query text)
      postData = {};
      if (rawPostData.operationName) postData.operationName = rawPostData.operationName;
      if (rawPostData.variables && Object.keys(rawPostData.variables).length > 0) {
        postData.variables = compactSample(rawPostData.variables, 0, 1, 5);
      }
    } else {
      postData = redactSensitiveFields(compactSample(rawPostData, 0, 2, 8));
    }
  } else if (rawPostData) {
    postData = typeof rawPostData === 'string' ? redactSensitiveFields(rawPostData.slice(0, 150)) : rawPostData;
  }

  // Compact response — GraphQL responses get shallower compaction (depth 1, fewer keys)
  let parsedResponse = null;
  if (responseBody) {
    try {
      const parsed = JSON.parse(responseBody);
      if (gql) {
        // GraphQL: only keep top-level keys from data to show schema shape
        parsedResponse = redactSensitiveFields(compactSample(parsed, 0, 1, 5));
      } else {
        parsedResponse = redactSensitiveFields(compactSample(parsed, 0, 2, 8));
      }
    } catch {
      parsedResponse = redactSensitiveFields(responseBody.slice(0, 150));
    }
  }

  return {
    method,
    url,
    headers: headers.filter(h => 
      ['authorization', 'content-type', 'accept', 'x-api-key'].includes(h.name.toLowerCase())
    ),
    postData,
    status: req.response.status,
    time: Math.round(req.time || 0),
    responseSample: parsedResponse,
    ...(operationName ? { gqlOp: operationName } : {}),
    ...(gql ? { isGraphQL: true } : {})
  };
}
