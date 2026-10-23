// services/prompts.js - Compact, token-efficient prompt engineering for Gemini
import { analyzeApiChaining } from './chaining.js';

/** Hard ceiling for the total prompt sent to Gemini (in characters). */
const MAX_PROMPT_CHARS = 5000;

/** Maximum unique endpoints to include in the prompt. */
const MAX_ENDPOINTS = 8;

export const FRAMEWORK_INSTRUCTIONS = {
  'playwright-ts': {
    name: 'Playwright API (TypeScript)',
    fileExtension: 'spec.ts',
    instructions: `Playwright API test suite in TypeScript using \`@playwright/test\`.
Rules:
- Never use module-level mutable variables. Dependent multi-step workflows go in a single test() with test.step() blocks.
- Never hardcode IDs. Dynamically create entities via POST, assert status 200/201, extract ID. If creation fails, fail immediately.
- Never use test.skip() on failed setup — fail explicitly.
- Validate parent objects/arrays before accessing nested properties.
- Use standard HTTP verbs only (get/post/put/delete). Never use QUERY.
- Use performance.now() with configurable SLA: \`const MAX_SLA = Number(process.env.MAX_RESPONSE_TIME_MS ?? 5000);\`
- Single import: \`import { test, expect } from '@playwright/test';\`
- Base URL: \`const BASE_URL = process.env.BASE_URL ?? '<detected>';\``
  },
  'pytest-python': {
    name: 'PyTest + HTTPX (Python)',
    fileExtension: 'test_api.py',
    instructions: `PyTest suite using httpx. No shared mutable globals. Use fixtures for dependent flows. Defensive dict access. ENV vars for config. HTML report: \`pytest --html=report.html\`.`
  },
  'restassured-java': {
    name: 'RestAssured (Java)',
    fileExtension: 'ApiSmokeTest.java',
    instructions: `REST Assured + JUnit 5. Chained journeys in single test or @TestMethodOrder. Extract IDs via jsonPath(). Defensive assertions. Base URI from env/system props.`
  },
  'postman-json': {
    name: 'Postman Collection (JSON v2.1.0)',
    fileExtension: 'collection.json',
    instructions: `Valid Postman v2.1.0 JSON. Sequential folders for chained flows. Extract IDs in pm.test scripts. Use {{variables}}. Defensive schema assertions.`
  },
  'k6-js': {
    name: 'k6 Performance & Smoke (JavaScript)',
    fileExtension: 'smoke.js',
    instructions: `k6 script. Chain inside VU iteration loop. Thresholds: http_req_failed < 0.01, p(95) < 1000.`
  },
  'html-report': {
    name: 'Standalone HTML Report',
    fileExtension: 'report.html',
    instructions: `Self-contained HTML report with KPI dashboard and collapsible request cards.`
  }
};

/**
 * Deduplicates captured requests.
 * For GraphQL: deduplicates by operation name (since all share POST /graphql).
 * For REST: deduplicates by METHOD + normalized PATH.
 */
export function deduplicateRequests(requests) {
  const seen = new Map();

  for (const req of requests) {
    let method = (req.method || 'GET').toUpperCase();
    if (method === 'QUERY') method = 'GET';

    let key;

    if (req.isGraphQL && req.gqlOp) {
      // GraphQL: deduplicate by operation name
      key = `GQL:${req.gqlOp}`;
    } else if (req.isGraphQL) {
      // GraphQL without operation name — use a single bucket
      key = 'GQL:__anonymous__';
    } else {
      // REST: normalize dynamic IDs in paths
      let path;
      try {
        const url = new URL(req.url);
        path = url.pathname.replace(/\/[0-9a-zA-Z]{16,}/gi, '/{id}')
                           .replace(/\/\d+(?=\/|$)/g, '/{id}');
      } catch {
        path = req.url;
      }
      key = `${method}:${path}`;
    }

    const existing = seen.get(key);
    const normalizedReq = { ...req, method };

    if (!existing) {
      seen.set(key, normalizedReq);
    } else {
      // Keep the one with more informative response
      const existingSize = JSON.stringify(existing.responseSample || '').length;
      const newSize = JSON.stringify(req.responseSample || '').length;
      if (newSize > existingSize) {
        seen.set(key, normalizedReq);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Builds a compact prompt for Gemini, hard-capped at MAX_PROMPT_CHARS.
 * Progressively strips response samples, then request bodies if needed.
 */
export function buildGeminiPrompt(requests, frameworkKey, suiteType = 'regression') {
  const fw = FRAMEWORK_INSTRUCTIONS[frameworkKey] || FRAMEWORK_INSTRUCTIONS['playwright-ts'];
  const deduped = deduplicateRequests(requests).slice(0, MAX_ENDPOINTS);
  const chainingAnalysis = analyzeApiChaining(deduped);

  // Build compact traffic — Phase 1: include everything
  let compactTraffic = deduped.map(r => {
    let method = (r.method || 'GET').toUpperCase();
    if (method === 'QUERY') method = 'GET';

    let path;
    try {
      const u = new URL(r.url);
      path = u.pathname + u.search;
    } catch {
      path = r.url;
    }

    const entry = { m: method, u: path, s: r.status };
    if (r.gqlOp) entry.op = r.gqlOp;
    if (r.postData) entry.b = r.postData;
    if (r.responseSample) entry.r = r.responseSample;
    return entry;
  });

  // Assemble the prompt and check size
  let prompt = assemblePrompt(fw, suiteType, chainingAnalysis, compactTraffic, deduped.length);

  // Phase 2: If too large, strip response samples
  if (prompt.length > MAX_PROMPT_CHARS) {
    compactTraffic = compactTraffic.map(e => {
      const { r, ...rest } = e;
      return rest;
    });
    prompt = assemblePrompt(fw, suiteType, chainingAnalysis, compactTraffic, deduped.length);
  }

  // Phase 3: If still too large, strip request bodies too
  if (prompt.length > MAX_PROMPT_CHARS) {
    compactTraffic = compactTraffic.map(e => {
      const { b, ...rest } = e;
      return rest;
    });
    prompt = assemblePrompt(fw, suiteType, chainingAnalysis, compactTraffic, deduped.length);
  }

  // Phase 4: If STILL too large, truncate the traffic JSON directly
  if (prompt.length > MAX_PROMPT_CHARS) {
    const trafficStr = JSON.stringify(compactTraffic);
    const truncatedTraffic = trafficStr.slice(0, 1500);
    prompt = assemblePrompt(fw, suiteType, chainingAnalysis, truncatedTraffic, deduped.length, true);
  }

  return prompt;
}

function assemblePrompt(fw, suiteType, chainingAnalysis, compactTraffic, endpointCount, isRawString = false) {
  const trafficBlock = isRawString ? compactTraffic : JSON.stringify(compactTraffic);
  const chainingBlock = chainingAnalysis.hasChaining
    ? `CHAINING:\n${chainingAnalysis.chainingSummary}\n`
    : '';

  return `You are a Senior SDET. Generate a runnable ${fw.name} ${suiteType} test suite draft from intercepted API traffic.

RULES:
- Test isolation: no shared mutable state across tests. Chain dependent steps in single test with test.step().
- No hardcoded IDs. Create entities dynamically, assert status, extract IDs.
- No silent skips. Fail explicitly on prerequisite failure.
- Defensive assertions: validate parent before child.
- Standard HTTP verbs only.

FRAMEWORK:
${fw.instructions}

${chainingBlock}ENDPOINTS (${endpointCount} unique):
${trafficBlock}

Output ONLY valid, complete, runnable code in a single markdown code block. Include setup comments.`;
}
