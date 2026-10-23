# ⚡ APISmoke: Autonomous API Test Suite & HTML Report Generator

An open-source Chrome Extension (Manifest V3) that captures API traffic you authorize, redacts common sensitive fields, analyzes **API chaining dependencies**, and uses **Google Gemini AI** to draft test suites and interactive HTML reports.

See the [Privacy Policy](PRIVACY.md) for details about captured traffic, redaction, and data sent to Google Gemini.

---

## 🎯 Core Concepts Used

1. **Authenticated Session Capture**: Records network requests from a browser session you are authorized to use. It does not bypass CAPTCHA, MFA, or access controls.
2. **Noise & Asset Filtering**: Filters common static assets and analytics domains to focus on API traffic.
3. **Sensitive Field Redaction**: Replaces common credential headers and secret-like JSON fields before generation. Review captured samples before sending; redaction cannot guarantee removal of all sensitive data.
4. **Automated API Chaining**: Identifies upstream dynamic values (such as auth tokens or resource IDs from responses) and maps them into downstream request headers, query parameters, or JSON payloads without hardcoded static IDs.

---

## 💻 Supported Frameworks & Compatibility

| Target Framework | Language / Format | Output File | Report Capabilities |
| :--- | :--- | :--- | :--- |
| **Playwright API** | TypeScript | `api_test_suite.spec.ts` | Built-in HTML report (`npx playwright test --reporter=html`) |
| **PyTest + HTTPX** | Python | `api_test_suite.test_api.py` | Pytest HTML report (`pytest --html=report.html`) |
| **RestAssured + JUnit 5** | Java | `api_test_suite.ApiSmokeTest.java` | Surefire / Allure Report |
| **Postman Collection** | JSON v2.1.0 | `api_test_suite.collection.json` | Newman HTML reporter (`newman run ... -r htmlextra`) |
| **k6 Smoke & Load** | JavaScript | `api_test_suite.smoke.js` | k6 web dashboard / summary export |
| **Standalone UI Report** | HTML5 / CSS3 / JS | `api_regression_report.html` | Self-contained, zero-dependency visual dashboard |

---

## 🚀 Quickstart Guide

> Record only traffic you are authorized to analyze. Captured request samples remain in the DevTools panel until cleared or closed. Generating a suite sends the captured samples and your API key to Google's Gemini API. Samples may contain sensitive information even after redaction; do not use confidential or personal data unless you are authorized to share it.

### 1. Get a Google Gemini API Key
* Visit [Google AI Studio](https://aistudio.google.com/app/apikey) to create an API key. Check Google's current pricing and usage limits.

### 2. Load Extension in Google Chrome
1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left) and select this repository folder:
   ```text
   api-smoke-generator-extension/
   ```
4. Open the **APISmoke** panel in DevTools and enter your Gemini API key. It is used for the current panel session and is not saved.

### 3. Record Live API Traffic
1. Open your target web application (production, staging, or demo like `https://dummyjson.com`) and log in.
2. Press `F12` (or Right-Click → **Inspect**) to open Chrome DevTools.
3. Switch to the **APISmoke** panel tab in DevTools.
4. Click **Start Recording** (pulses red).
5. Interact with the website (e.g. login, search products, add items to cart, view profile).
6. Click **Stop Recording**.

### 4. Generate Test Suite & HTML Report
* **Test Code**: Choose your target framework and suite scope (*Smoke* or *Regression*), then click **⚡ Generate Test Suite**. View, **Copy**, or **Download** the generated test file.
* **Interactive HTML Report**: Click **📊 Generate UI HTML Report** or switch to the **Interactive HTML Report** tab to inspect the visual pipeline, response contracts, and schema checks directly. Use **🌐 Open in Tab** to view it full screen.

---

## 📊 How the UI HTML Report Is Generated

The extension builds a zero-dependency, self-contained single-file HTML report ([`services/reporter.js`](services/reporter.js)):

1. **Executive KPI Dashboard**: Summarizes total requests, pass rate, total execution latency, and detected chained links.
2. **Visual Chaining Pipeline**: Illustrates step-by-step dependency flow (e.g. Step 1 `POST /auth/login` yields token -> Step 2 `GET /auth/me` consumes `Bearer token` -> Step 3 extracts product ID -> Step 4 creates cart combining user + product).
3. **Filterable Request Cards**: Collapsible cards containing request headers, JSON payloads, response contract samples, and latency in milliseconds.
4. **Contract Assertions**: Displays status code verifications, payload schema checks, and SLA timing compliance.

---

## 🛡️ Senior SDET Production Standards

APISmoke enforces enterprise-grade automation standards in every generated test suite:
* **Zero Shared Mutable State (P0)**: Dependent journeys are encapsulated in a single `test()` using sequential `test.step()` blocks. Prevents race conditions and flaky test runs in Playwright parallel workers.
* **Zero Hardcoded Fallbacks (P0)**: Resources (like carts or auth tokens) are dynamically generated, validated, and chained. Never uses brittle hardcoded fallback IDs.
* **No Silent Skips (P0)**: Prerequisite failures fail loudly and clearly for CI/CD reporting instead of being masked by `test.skip()`.
* **Defensive Schema Assertions (P1)**: Validates parent object and array types before accessing nested keys (e.g. `expect(item.category).toBeTruthy()` before `item.category.name`).
* **Standard HTTP REST Verbs (P1)**: Automatically normalizes non-standard methods (like `QUERY`) to standard `GET` with params.
* **Monotonic Duration SLA (P1)**: Uses `performance.now()` with configurable thresholds (`process.env.MAX_RESPONSE_TIME_MS`) to protect functional tests against network latency spikes.

---

## 📁 Standardized Project Structure

```text
api-smoke-generator-extension/
├── .gitignore               # Ignores environment files, reports, and node artifacts
├── package.json             # Package metadata and keywords
├── manifest.json            # Chrome Extension Manifest V3 configuration
├── README.md                # Documentation and operational guide
├── examples/                # Enterprise reference test suites
│   └── practice_software_testing.spec.ts  # SDET-compliant Playwright suite
├── popup/                   # Extension toolbar popup
│   ├── popup.html           # API key management modal
│   └── popup.js             # Chrome storage sync helper
├── devtools/                # DevTools panel interface
│   ├── devtools.html        # DevTools panel host page
│   ├── devtools.js          # Registers APISmoke tab in Chrome DevTools
│   ├── panel.html           # Split-screen UI (traffic stream & AI generator)
│   ├── panel.css            # Dark developer theme styling & tabs
│   └── panel.js             # Network listener, UI controller & export logic
└── services/                # Core domain and AI services
    ├── filter.js            # Filters static assets, CSS/JS, and trackers
    ├── sanitizer.js         # Masks bearer tokens, session cookies, and secrets
    ├── chaining.js          # Detects dynamic token/ID correlation between requests
    ├── reporter.js          # Synthesizes standalone, interactive UI HTML reports
    ├── prompts.js           # Prompt engineering with API chaining rules
    └── gemini.js            # Google AI Studio Gemini API client
```

---

## 📤 Preparing to Push to GitHub

Initialize git and push to your remote repository:

```bash
git init
git add .
git commit -m "feat: initial commit for APISmoke generator with API chaining & HTML reports"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

> [!NOTE]
> The Gemini API key is entered in the DevTools panel and is not persisted by the extension. Framework, suite, and model preferences remain in local extension storage.
