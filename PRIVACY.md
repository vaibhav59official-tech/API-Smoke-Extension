# Privacy Policy

APISmoke runs locally in Chrome DevTools. It does not operate a project server or send telemetry to its maintainers.

## Data APISmoke processes

When you start recording, the extension reads network request metadata and response samples visible to Chrome DevTools for the inspected tab. This can include URLs, methods, status codes, headers, request bodies, response bodies, and timing. Common credential headers and secret-like JSON fields are redacted, but redaction is not guaranteed to remove all personal, confidential, or authentication data.

Captured samples are held in the open DevTools panel's memory. They are cleared when you use Clear or close the panel. Framework, suite, and model preferences are stored in Chrome extension local storage. The API key is held in the panel while it is open and is not persisted by APISmoke.

## Sharing with AI Providers (Kimi / Moonshot AI)

When you generate a test suite, APISmoke sends the captured samples and the API key you entered directly to the selected AI provider (Moonshot AI / Kimi or Google Gemini) over HTTPS. The provider processes that data under their applicable terms and policies. Review samples and remove sensitive traffic before generation. Generated code and reports remain in the browser unless you choose to copy, download, or otherwise share them.

## Your choices

Recording is user-initiated and requires confirmation. You can stop recording at any time, clear captured samples, close the DevTools panel, or avoid generating a suite. Use APISmoke only with traffic you are authorized to inspect and share with the AI provider.

## Changes and contact

This policy may be updated with the project. For privacy questions, open an issue in the project's public repository.
