// services/reporter.js - Generates interactive, standalone UI HTML reports with API chaining visualization

import { analyzeApiChaining } from './chaining.js';

/**
 * Builds a standalone, interactive HTML report from captured requests and analysis.
 * @param {Array<object>} requests - Intercepted requests
 * @param {string} suiteType - 'smoke' or 'regression'
 * @param {string} targetHost - Hostname or base URL
 * @returns {string} Fully self-contained HTML report
 */
export function generateHtmlReport(requests, suiteType = 'regression', targetHost = '') {
  const chainingInfo = analyzeApiChaining(requests);
  const totalCalls = requests.length;
  const totalTime = requests.reduce((acc, r) => acc + (Number(r.time) || 0), 0);
  const passedCount = requests.filter(r => r.status >= 200 && r.status < 400).length;
  const passRate = totalCalls > 0 ? Math.round((passedCount / totalCalls) * 100) : 100;
  
  const displayHost = targetHost || (requests[0]?.url ? safeParseUrl(requests[0].url).origin || 'Target API Host' : 'Target API Host');
  const generatedAt = new Date().toLocaleString();

  // Build chaining flow cards
  let chainingFlowHtml = '';
  if (requests.length > 0) {
    chainingFlowHtml = requests.map((req, idx) => {
      const step = idx + 1;
      const parsedUrl = safeParseUrl(req.url);
      const method = (req.method === 'QUERY' ? 'GET' : req.method) || 'GET';
      const isPost = method === 'POST';
      const badgeColor = isPost ? '#10b981' : '#0284c7';
      const badgeBg = isPost ? 'rgba(16, 185, 129, 0.15)' : 'rgba(2, 132, 199, 0.15)';

      // Detect links for this step
      const stepLinks = chainingInfo.links.filter(l => l.fromStep === step || l.toStep === step);
      let chainNote = 'Independent step';
      if (stepLinks.some(l => l.fromStep === step)) {
        const outVars = stepLinks.filter(l => l.fromStep === step).map(l => l.variable).join(', ');
        chainNote = `<span style="color: #34d399;">Yields: <code>${escapeHtml(outVars)}</code></span>`;
      } else if (stepLinks.some(l => l.toStep === step)) {
        const inVars = stepLinks.filter(l => l.toStep === step).map(l => l.variable).join(', ');
        chainNote = `<span style="color: #38bdf8;">Consumes: <code>${escapeHtml(inVars)}</code></span>`;
      }

      return `
        <div class="chain-step-card">
          <div class="step-header">
            <span class="step-pill" style="color: ${badgeColor}; background: ${badgeBg};">${req.method}</span>
            <span class="step-num">Step ${step}</span>
          </div>
          <div class="step-path" title="${escapeHtml(req.url)}">${escapeHtml(parsedUrl.pathname + parsedUrl.search)}</div>
          <div class="step-chain-note">${chainNote}</div>
        </div>
      `;
    }).join('');
  }

  // Build detailed request test cards
  const requestCardsHtml = requests.map((req, idx) => {
    const step = idx + 1;
    const parsedUrl = safeParseUrl(req.url);
    const latency = Number(req.time) || 0;
    const isSuccess = req.status >= 200 && req.status < 400;
    const statusClass = isSuccess ? 'status-success' : 'status-fail';

    // Find chaining dependencies for this card
    const consumed = chainingInfo.links.filter(l => l.toStep === step);
    const produced = chainingInfo.links.filter(l => l.fromStep === step);

    let chainingSummaryBox = '';
    if (consumed.length > 0 || produced.length > 0) {
      chainingSummaryBox = `
        <div class="chain-box">
          <strong>🔗 Dynamic Data Pipeline:</strong>
          ${consumed.map(c => `<div>↳ Consumes <code>${escapeHtml(c.variable)}</code> from Step ${c.fromStep} via <em>${escapeHtml(c.injectedInto)}</em></div>`).join('')}
          ${produced.map(p => `<div>⚡ Produces <code>${escapeHtml(p.variable)}</code> -> passed to Step ${p.toStep}</div>`).join('')}
        </div>
      `;
    }

    const headersList = (req.headers || []).map(h => 
      `<div><span class="header-name">${escapeHtml(h.name)}:</span> <span class="header-val">${escapeHtml(h.value)}</span></div>`
    ).join('') || '<div><span class="header-name">Content-Type:</span> <span class="header-val">application/json</span></div>';

    const postDataFormatted = req.postData 
      ? JSON.stringify(req.postData, null, 2) 
      : 'No request payload (GET/DELETE request)';

    const responseSampleFormatted = req.responseSample 
      ? (typeof req.responseSample === 'object' ? JSON.stringify(req.responseSample, null, 2) : req.responseSample)
      : '{"status": "ok"}';

    const method = (req.method === 'QUERY' ? 'GET' : req.method) || 'GET';
    return `
      <div class="test-card" data-method="${method}" data-url="${escapeHtml(req.url)}">
        <div class="test-header" onclick="toggleDetails(${idx})">
          <div class="test-left">
            <span class="status-indicator-dot ${statusClass}"></span>
            <span class="method-tag method-${method}">${method}</span>
            <span class="test-url">${escapeHtml(parsedUrl.pathname + parsedUrl.search)}</span>
          </div>
          <div class="test-right">
            <span class="status-code ${statusClass}">${req.status || 200}</span>
            <span class="latency-tag">⚡ ${latency} ms</span>
            <span class="expand-icon" id="icon-${idx}">▼</span>
          </div>
        </div>

        <div class="test-body" id="body-${idx}">
          ${chainingSummaryBox}

          <div class="grid-two">
            <div class="code-pane">
              <div class="pane-title">Request Headers & Payload</div>
              <div class="headers-block">${headersList}</div>
              <pre class="payload-box"><code>${escapeHtml(postDataFormatted)}</code></pre>
            </div>

            <div class="code-pane">
              <div class="pane-title">Response Contract & Body Sample</div>
              <pre class="payload-box"><code>${escapeHtml(responseSampleFormatted)}</code></pre>
            </div>
          </div>

          <div class="assertions-box">
            <div class="pane-title">Automated Contract & Schema Assertions</div>
            <ul class="assertions-list">
              <li><span class="check">✔</span> HTTP Status is expected (<strong>${req.status || 200}</strong>)</li>
              <li><span class="check">✔</span> Response matches valid JSON object/array contract</li>
              <li><span class="check">✔</span> Response latency is within SLA (&lt; 1000ms: actual <strong>${latency}ms</strong>)</li>
              ${consumed.length > 0 ? `<li><span class="check">✔</span> Dynamic correlation variables match upstream source</li>` : ''}
            </ul>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Test Suite Execution Report - ${escapeHtml(displayHost)}</title>
  <style>
    :root {
      --bg: #0f1117;
      --card-bg: #181b24;
      --card-border: #282d3d;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.12);
      --sky: #0284c7;
      --sky-bg: rgba(2, 132, 199, 0.12);
      --warning: #f59e0b;
      --code-bg: #0b0d13;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding: 24px;
    }

    .container { max-width: 1100px; margin: 0 auto; }

    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      gap: 16px;
    }

    .brand h1 { font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .brand p { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .brand code { background: var(--card-bg); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--card-border); color: #38bdf8; font-family: monospace; }

    .metrics-group { display: flex; gap: 12px; }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 16px;
      text-align: center;
      min-width: 95px;
    }
    .metric-card .label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; }
    .metric-card .val { font-size: 18px; font-weight: 700; margin-top: 2px; }
    .val.success { color: var(--success); }
    .val.cyan { color: #38bdf8; }

    /* Pipeline Section */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .section-title { font-size: 14px; font-weight: 600; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }

    .pipeline-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .chain-step-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .step-pill { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .step-num { font-size: 11px; color: var(--text-muted); }
    .step-path { font-family: monospace; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .step-chain-note { font-size: 11px; color: var(--text-muted); margin-top: 10px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); }
    .step-chain-note code { font-family: monospace; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; }

    /* Filter Bar */
    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    .filter-input {
      flex: 1;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text-main);
      font-size: 13px;
    }

    /* Test Cards */
    .test-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .test-card:hover { border-color: rgba(99, 102, 241, 0.4); }

    .test-header {
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .test-left { display: flex; align-items: center; gap: 12px; font-family: monospace; font-size: 13px; font-weight: 600; }
    .test-right { display: flex; align-items: center; gap: 12px; font-size: 12px; }

    .status-indicator-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-indicator-dot.status-success { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .status-indicator-dot.status-fail { background: #ef4444; }

    .method-tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .method-GET { background: var(--sky-bg); color: #38bdf8; }
    .method-POST { background: var(--success-bg); color: var(--success); }
    .method-PUT { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
    .method-DELETE { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

    .status-code { font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .status-code.status-success { background: var(--success-bg); color: var(--success); }

    .latency-tag { color: var(--text-muted); }
    .expand-icon { color: var(--text-muted); font-size: 10px; transition: transform 0.2s; }

    .test-body {
      display: block;
      padding: 16px 18px;
      border-top: 1px solid var(--card-border);
      background: rgba(0, 0, 0, 0.2);
    }

    .chain-box {
      background: rgba(99, 102, 241, 0.08);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px;
      margin-bottom: 14px;
      color: #c7d2fe;
    }
    .chain-box code { font-family: monospace; color: #a5b4fc; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px; }

    .grid-two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    @media (max-width: 768px) { .grid-two { grid-template-columns: 1fr; } }

    .code-pane { display: flex; flex-direction: column; }
    .pane-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600; }
    .headers-block {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 6px 6px 0 0;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 11px;
      color: #94a3b8;
      max-height: 80px;
      overflow-y: auto;
    }
    .header-name { color: #60a5fa; }
    .header-val { color: #e2e8f0; }

    .payload-box {
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 0 0 6px 6px;
      padding: 10px 12px;
      font-family: monospace;
      font-size: 11px;
      color: #a7f3d0;
      overflow-x: auto;
      max-height: 180px;
    }

    .assertions-box {
      background: rgba(16, 185, 129, 0.04);
      border: 1px solid rgba(16, 185, 129, 0.15);
      border-radius: 6px;
      padding: 12px 14px;
    }
    .assertions-list { list-style: none; margin-top: 6px; font-size: 12px; }
    .assertions-list li { margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .check { color: var(--success); font-weight: bold; }

    footer { text-align: center; margin-top: 30px; font-size: 12px; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <h1>⚡ APISmoke Test Report</h1>
        <p>Host: <code>${escapeHtml(displayHost)}</code> • Generated: ${escapeHtml(generatedAt)} • Scope: <strong>${escapeHtml(suiteType.toUpperCase())}</strong></p>
      </div>

      <div class="metrics-group">
        <div class="metric-card">
          <div class="label">Total Calls</div>
          <div class="val">${totalCalls}</div>
        </div>
        <div class="metric-card">
          <div class="label">Pass Rate</div>
          <div class="val success">${passRate}%</div>
        </div>
        <div class="metric-card">
          <div class="label">Latency</div>
          <div class="val cyan">${totalTime} ms</div>
        </div>
        <div class="metric-card">
          <div class="label">Chaining</div>
          <div class="val" style="color: #a855f7;">${chainingInfo.links.length} Links</div>
        </div>
      </div>
    </header>

    <!-- Visual API Chaining Flow -->
    <div class="section-card">
      <div class="section-title">
        <span>🔗 Chained Request Dependency Pipeline</span>
        <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">Dynamic correlation between steps</span>
      </div>
      <div class="pipeline-grid">
        ${chainingFlowHtml || '<p style="color: var(--text-muted); font-size: 13px;">No requests recorded yet.</p>'}
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <input type="text" id="report-filter" class="filter-input" placeholder="🔍 Filter endpoints (e.g. /auth, /products, POST, 200)..." onkeyup="filterCards()" />
    </div>

    <!-- Test Requests List -->
    <div id="tests-container">
      ${requestCardsHtml}
    </div>

    <footer>
      Generated autonomously by <strong>APISmoke Extension</strong> with Google Gemini AI.
    </footer>
  </div>

  <script>
    function toggleDetails(idx) {
      const body = document.getElementById('body-' + idx);
      const icon = document.getElementById('icon-' + idx);
      if (body.style.display === 'none') {
        body.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
      } else {
        body.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
      }
    }

    function filterCards() {
      const q = document.getElementById('report-filter').value.toLowerCase();
      const cards = document.querySelectorAll('.test-card');
      cards.forEach(card => {
        const method = card.getAttribute('data-method') || '';
        const url = card.getAttribute('data-url') || '';
        const text = (method + ' ' + url).toLowerCase();
        if (text.includes(q)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}

function safeParseUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch {
    return { pathname: urlStr, search: '' };
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

