# Changelog

## 0.1.0

The first release.

- **Invoist** node: extract a document from a binary field, get a document
  with its extracted fields, get many documents (status, search and flagged
  filters), get many review items (pending by default), and resolve or
  dismiss a review item. Usable as a tool by n8n's AI Agent.
- **Invoist Trigger**: starts a workflow when a document arrives, an
  extraction completes or fails, or a review item is resolved. Registers an
  Invoist webhook endpoint on activation and removes it on deactivation.
- **Invoist API** credential: a business workspace's API key, checked against
  the API when saved. A key from Invoist Personal is refused with a plain
  explanation.
