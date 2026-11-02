# n8n-nodes-invoist

This is an n8n community node. It lets you use [Invoist](https://invoi.st) in
your n8n workflows.

Invoist reads invoices and receipts (PDF, PNG or JPEG) and gives back their
fields as data: who sent it, the invoice number, dates, amounts, line items
and the payment reference. Anything that looks off goes to a review queue for
a person to check.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

[Installation](#installation) ·
[Operations](#operations) ·
[Credentials](#credentials) ·
[Compatibility](#compatibility) ·
[Usage](#usage) ·
[Resources](#resources) ·
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation. The package name is
`n8n-nodes-invoist`.

## Operations

**Invoist** node

| Resource | Operation | What it does |
|---|---|---|
| Document | Extract | Sends a file from a binary field to Invoist and starts reading it. Returns the new document; its extraction is `pending` until reading finishes. |
| Document | Get | One document with its extracted fields, line items and any review items. |
| Document | Get Many | Recent documents, newest first, one item each. Filter by status, a search text, or flagged only. |
| Review Item | Get Many | Items flagged for a second look, pending by default. |
| Review Item | Resolve | Marks a review item resolved or dismissed. |

The Invoist node can also be used as a tool by n8n's AI Agent.

**Invoist Trigger** node starts a workflow when:

- a document arrives (upload, API or email),
- an extraction completes, and its fields are ready,
- an extraction fails,
- a review item is resolved or dismissed.

When you activate the workflow, the trigger registers its URL with Invoist as
a webhook endpoint; when you deactivate it, the endpoint is removed. You'll
see it in Invoist under Integrations › Webhooks as "n8n trigger".

## Credentials

You need an Invoist account for a business and an API key:

1. In Invoist, open **Integrations › API** and create a key. It starts with
   `inv_sk_` and works for one workspace.
2. In n8n, create an **Invoist API** credential and paste the key. n8n checks
   it against the API when you save.

Leave **API Base URL** as `https://api.invoi.st` unless Invoist gave you
another address. A key from Invoist Personal (for a household's bills) won't
work: these nodes use the business API.

## Compatibility

Built and tested against `n8n-workflow` 2.16 (n8n 2.x). It uses only the
standard node API (`n8nNodesApiVersion` 1), so earlier n8n 1.x versions that
support community nodes should work too, but they aren't tested.

## Usage

**Read every invoice that lands in a mailbox.** Email Trigger (IMAP) →
Invoist (Document › Extract, binary field `attachment_0`). Then a separate
workflow: Invoist Trigger (Extraction Completed) → Invoist (Document › Get,
Document ID `{{ $json.data.document_id }}`) → your spreadsheet or
accounting app.

Reading takes a few seconds and happens in the background, so Extract returns
straight away with `extraction.status` set to `pending`. Use the trigger, not
a wait loop, to get the result.

The trigger's output is the event as Invoist sends it:

```json
{
  "id": "0199f0c2-...",
  "type": "extraction.completed",
  "created_at": "2026-10-28T09:15:00Z",
  "data": { "document_id": "...", "extraction_id": "...", "status": "done" }
}
```

Money is always in cents (`total_cents: 5489` is 54.89). Uploading the same
file twice returns the first document with `duplicate: true` rather than
reading and charging for it again.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Invoist API documentation](https://invoi.st/docs/api)
- [Invoist webhooks](https://invoi.st/docs/apps/webhooks)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
npm ci
npm run lint     # n8n's community-node rules (strict mode, as for verification)
npm test         # builds, then runs the nodes against fakes of n8n and the API
INVOIST_TEST_KEY=inv_sk_... npm test   # and against the live API (INVOIST_TEST_URL for another server)
npm run dev      # n8n with this node loaded, rebuilt on change
```

### How releases work

Changes are made in Invoist's own repository and released here: a release
is one commit with the new files, and a `v<version>` tag on it. Pushing the tag runs
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which lints,
tests, builds and publishes to npm with a provenance statement, as n8n
requires for verified community nodes. Don't run `npm run release` or
`npm publish` locally: outside GitHub Actions they'd publish without
provenance (and `npm publish` refuses on purpose).

## License

[MIT](LICENSE.md)
