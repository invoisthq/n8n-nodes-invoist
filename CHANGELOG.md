# Changelog

## 0.1.1

The same nodes as 0.1.0, which never reached npm: its publish workflow
failed while installing dependencies.

- The publish and CI workflows install with `npm ci --ignore-scripts` and use
  `actions/checkout` and `actions/setup-node` v7. A dependency of
  `n8n-workflow` has no prebuilt binary for the newest Node and failed to
  compile; the nodes never load it.
- The tests read the API's spec and its webhook events from `testdata/`, so
  they run in this repository too, and the live tests default to
  `https://api.invoi.st`.

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
