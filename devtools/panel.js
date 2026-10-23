// devtools/panel.js - Main controller for DevTools UI
import { isApiRequest } from '../services/filter.js';
import { buildSanitizedRequestRecord } from '../services/sanitizer.js';
import { buildGeminiPrompt, FRAMEWORK_INSTRUCTIONS } from '../services/prompts.js';
import { callGemini } from '../services/gemini.js';
import { generateHtmlReport } from '../services/reporter.js';

let isRecording = false;
const capturedRequests = [];
let generatedCode = '';
let generatedHtmlReport = '';
let activeTab = 'code';

// DOM Elements
const recordBtn = document.getElementById('record-btn');
const recordText = document.getElementById('record-text');
const clearBtn = document.getElementById('clear-btn');
const domainFilterInput = document.getElementById('domain-filter');
const requestCountBadge = document.getElementById('request-count-badge');
const requestList = document.getElementById('request-list');

const frameworkSelect = document.getElementById('framework-select');
const suiteTypeSelect = document.getElementById('suite-type-select');
const modelSelect = document.getElementById('model-select');
const apiKeyInput = document.getElementById('api-key-input');
const generateBtn = document.getElementById('generate-btn');
const generateReportBtn = document.getElementById('generate-report-btn');
const genStatus = document.getElementById('gen-status');

const tabCodeBtn = document.getElementById('tab-code-btn');
const tabReportBtn = document.getElementById('tab-report-btn');
const codeOutput = document.getElementById('code-output');
const reportFrame = document.getElementById('report-frame');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const openTabBtn = document.getElementById('open-tab-btn');

// List of outdated models to auto-migrate
const OUTDATED_MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

// Remove API keys saved by previous versions.
chrome.storage.local.remove('geminiApiKey');

// 1. Initialize Settings from storage
chrome.storage.local.get(['targetFramework', 'suiteType', 'geminiModel'], (result) => {
  if (result.targetFramework) frameworkSelect.value = result.targetFramework;
  if (result.suiteType) suiteTypeSelect.value = result.suiteType;
  if (result.geminiModel) {
    const validModel = OUTDATED_MODELS.includes(result.geminiModel) ? 'gemini-3.8-flash' : result.geminiModel;
    modelSelect.value = validModel;
    if (validModel !== result.geminiModel) {
      chrome.storage.local.set({ geminiModel: 'gemini-3.8-flash' });
    }
  }
  updateGenerateButtonState();
});

frameworkSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetFramework: frameworkSelect.value });
});
suiteTypeSelect.addEventListener('change', () => {
  chrome.storage.local.set({ suiteType: suiteTypeSelect.value });
});
modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ geminiModel: modelSelect.value });
});

// 2. Recording Toggle
recordBtn.addEventListener('click', () => {
  if (!isRecording && !confirm('Record network traffic for this tab? Only record traffic you are authorized to analyze. Captured samples stay in this panel until cleared or closed; generating a suite sends them to Google Gemini and may include sensitive data.')) return;

  isRecording = !isRecording;
  if (isRecording) {
    recordBtn.classList.add('recording');
    recordText.textContent = 'Stop Recording';
  } else {
    recordBtn.classList.remove('recording');
    recordText.textContent = 'Start Recording';
  }
});

// 3. Clear
clearBtn.addEventListener('click', () => {
  capturedRequests.length = 0;
  generatedCode = '';
  generatedHtmlReport = '';
  requestList.innerHTML = `
    <tr class="empty-state">
      <td colspan="3">Click "Start Recording" and interact with your app.</td>
    </tr>
  `;
  codeOutput.textContent = '// Capture traffic to generate test suite...';
  reportFrame.srcdoc = '';
  switchTab('code');
  updateRequestCount();
  updateGenerateButtonState();
});

// 4. Network Listener
chrome.devtools.network.onRequestFinished.addListener((request) => {
  if (!isRecording) return;

  const domainFilter = domainFilterInput.value.trim();
  if (!isApiRequest(request, domainFilter)) return;

  request.getContent((body) => {
    const record = buildSanitizedRequestRecord(request, body || '');
    capturedRequests.push(record);
    renderRequestRow(record);
    updateRequestCount();
    updateGenerateButtonState();
  });
});

function renderRequestRow(record) {
  if (capturedRequests.length === 1) requestList.innerHTML = '';

  const tr = document.createElement('tr');
  const methodClass = `method-${record.method}`;
  
  let statusClass = 'status-2xx';
  if (record.status >= 300 && record.status < 400) statusClass = 'status-3xx';
  if (record.status >= 400) statusClass = 'status-4xx';

  let displayUrl = record.url;
  try {
    const parsed = new URL(record.url);
    displayUrl = parsed.pathname + parsed.search;
  } catch {}

  // Show GraphQL operation name if available
  const gqlLabel = record.gqlOp ? ` [${record.gqlOp}]` : '';

  tr.innerHTML = `
    <td><span class="method-tag ${methodClass}">${record.method}</span></td>
    <td><span class="status-tag ${statusClass}">${record.status || '-'}</span></td>
    <td title="${escapeHtml(record.url)}">${escapeHtml(displayUrl)}${escapeHtml(gqlLabel)}</td>
  `;
  requestList.appendChild(tr);

  const wrapper = document.querySelector('.request-table-wrapper');
  wrapper.scrollTop = wrapper.scrollHeight;
}

function updateRequestCount() {
  requestCountBadge.textContent = `${capturedRequests.length} call${capturedRequests.length === 1 ? '' : 's'}`;
}

function updateGenerateButtonState() {
  const hasRequests = capturedRequests.length > 0;
  const hasKey = (apiKeyInput.value || '').trim().length > 0;
  generateBtn.disabled = !hasRequests || !hasKey;
  generateReportBtn.disabled = !hasRequests;
}

apiKeyInput.addEventListener('input', updateGenerateButtonState);

// 5. Generate Test Suite with Gemini
generateBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Please enter your Gemini API Key first.');
    return;
  }
  if (capturedRequests.length === 0) {
    alert('No API requests captured. Record some traffic first!');
    return;
  }

  const framework = frameworkSelect.value;
  const suiteType = suiteTypeSelect.value;
  const rawModel = modelSelect.value;
  const model = OUTDATED_MODELS.includes(rawModel) ? 'gemini-3.8-flash' : (rawModel || 'gemini-3.8-flash');

  generateBtn.disabled = true;
  generateReportBtn.disabled = true;
  switchTab('code');

  const prompt = buildGeminiPrompt(capturedRequests, framework, suiteType);
  codeOutput.textContent = `// Prompt built (${prompt.length} chars). Sending to Gemini...`;
  genStatus.textContent = '⚡ Contacting Gemini...';

  try {
    const result = await callGemini(apiKey, prompt, model, {
      onStatus: (msg) => { genStatus.textContent = msg; }
    });

    generatedCode = result;
    codeOutput.textContent = result;

    // Auto-generate companion HTML report
    generatedHtmlReport = generateHtmlReport(capturedRequests, suiteType);
    reportFrame.srcdoc = generatedHtmlReport;

    genStatus.textContent = '✅ Suite generated! Switch to 📊 HTML Report tab for details.';
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    codeOutput.textContent = `// ❌ Generation failed:\n// ${err.message}\n\n// ✅ TIP: Click "📊 Generate UI HTML Report" for an instant offline report!`;
    genStatus.textContent = '❌ Failed — use "Generate UI HTML Report" as fallback.';

    // Auto-fallback: generate HTML report
    generatedHtmlReport = generateHtmlReport(capturedRequests, suiteType);
    reportFrame.srcdoc = generatedHtmlReport;
    downloadBtn.disabled = false;
  } finally {
    generateBtn.disabled = false;
    generateReportBtn.disabled = false;
  }
});

// 6. Generate Direct HTML Report
generateReportBtn.addEventListener('click', () => {
  if (capturedRequests.length === 0) {
    alert('No API requests captured. Record some traffic first!');
    return;
  }

  const suiteType = suiteTypeSelect.value;
  generatedHtmlReport = generateHtmlReport(capturedRequests, suiteType);
  reportFrame.srcdoc = generatedHtmlReport;
  
  switchTab('report');
  genStatus.textContent = 'Interactive HTML Report ready!';
  downloadBtn.disabled = false;
  copyBtn.disabled = false;
});

// 7. Tab Switching
function switchTab(tab) {
  activeTab = tab;
  if (tab === 'code') {
    tabCodeBtn.classList.add('active');
    tabReportBtn.classList.remove('active');
    codeOutput.style.display = 'block';
    reportFrame.style.display = 'none';
    openTabBtn.style.display = 'none';
    copyBtn.textContent = '📋 Copy Code';
    downloadBtn.textContent = '💾 Download Suite';
  } else {
    tabReportBtn.classList.add('active');
    tabCodeBtn.classList.remove('active');
    codeOutput.style.display = 'none';
    reportFrame.style.display = 'block';
    openTabBtn.style.display = 'inline-flex';
    copyBtn.textContent = '📋 Copy HTML';
    downloadBtn.textContent = '💾 Download Report';

    if (!generatedHtmlReport && capturedRequests.length > 0) {
      generatedHtmlReport = generateHtmlReport(capturedRequests, suiteTypeSelect.value);
      reportFrame.srcdoc = generatedHtmlReport;
      downloadBtn.disabled = false;
      copyBtn.disabled = false;
    }
  }
}

tabCodeBtn.addEventListener('click', () => switchTab('code'));
tabReportBtn.addEventListener('click', () => switchTab('report'));

// 8. Open Report in Full Tab
openTabBtn.addEventListener('click', () => {
  if (!generatedHtmlReport) return;
  const blob = new Blob([generatedHtmlReport], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
});

// 9. Copy
copyBtn.addEventListener('click', () => {
  const contentToCopy = activeTab === 'report' ? generatedHtmlReport : generatedCode;
  if (!contentToCopy) return;

  navigator.clipboard.writeText(contentToCopy).then(() => {
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
  });
});

// 10. Download
downloadBtn.addEventListener('click', () => {
  let content = '';
  let filename = '';

  if (activeTab === 'report' || frameworkSelect.value === 'html-report') {
    content = generatedHtmlReport || generateHtmlReport(capturedRequests, suiteTypeSelect.value);
    filename = `api_${suiteTypeSelect.value}_report.html`;
  } else {
    content = generatedCode;
    const framework = frameworkSelect.value;
    const fileExt = FRAMEWORK_INSTRUCTIONS[framework]?.fileExtension || 'txt';
    filename = `api_test_suite.${fileExt}`;
  }

  if (!content) return;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
