// services/filter.js - Filters out noise, analytics, and static assets

const IGNORED_EXTENSIONS = [
  '.js', '.mjs', '.css', '.scss', '.less',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.map'
];

const IGNORED_DOMAINS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'doubleclick.net',
  'segment.io',
  'segment.com',
  'sentry.io',
  'datadoghq.com',
  'hotjar.com',
  'mixpanel.com',
  'clarity.ms',
  'intercom.io',
  'facebook.net',
  'connect.facebook.net',
  'amplitude.com',
  'newrelic.com'
];

/**
 * Determines whether a network request is a relevant backend API call.
 * @param {object} req - HAR request object from chrome.devtools.network
 * @param {string} domainFilter - Optional domain to filter by (e.g. "api.example.com")
 * @returns {boolean}
 */
export function isApiRequest(req, domainFilter = '') {
  const urlString = req?.request?.url;
  if (typeof urlString !== 'string') return false;
  
  // Must be valid HTTP/HTTPS
  if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
    return false;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return false;
  }

  // Domain filter
  const requestedDomain = domainFilter.trim().toLowerCase();
  if (requestedDomain && parsedUrl.hostname.toLowerCase() !== requestedDomain &&
      !parsedUrl.hostname.toLowerCase().endsWith(`.${requestedDomain}`)) {
    return false;
  }

  // Filter known tracking domains
  if (IGNORED_DOMAINS.some(domain => parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`))) {
    return false;
  }

  // Filter static assets by file extension in path
  const path = parsedUrl.pathname.toLowerCase();
  if (IGNORED_EXTENSIONS.some(ext => path.endsWith(ext))) {
    return false;
  }

  // Check content type or resource type
  const mimeType = (req.response?.content?.mimeType || '').toLowerCase();
  // If mimeType explicitly indicates JSON or XML API
  if (mimeType.includes('application/json') || mimeType.includes('application/problem+json') || mimeType.includes('application/graphql')) {
    return true;
  }

  // Keep if resourceType is xhr or fetch
  const resourceType = req._resourceType || '';
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    return true;
  }

  // Common API URL patterns (e.g., /api/, /v1/, /graphql, /rest/)
  if (path.includes('/api/') || path.includes('/v1/') || path.includes('/v2/') || path.includes('/v3/') || path.includes('/graphql')) {
    return true;
  }

  return false;
}
