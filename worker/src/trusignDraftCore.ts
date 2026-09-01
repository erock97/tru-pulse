// Free-text draft assembly — ported verbatim from TRU OS's trusignDraftCore:
// create the envelope, build and upload the stamped draft PDF, set recipients
// (routing order = supplied order), one signature field per signer/approver on
// the last page, then fetch the review bundle. Injected-client style so the
// whole sequence is testable without a live key.
//
// Any post-creation failure throws with the envelope id in the message — the
// draft already exists in TruSign at that point (an orphan a void can clean
// up), and hiding that would leave it unexplained in the list.

import { buildContractDraftPdf, type DraftPdfInput } from './contractPdf.js';

export interface DraftClient {
  json(method: string, path: string, body: unknown): Promise<any>;
  pdf(path: string, filename: string, bytes: Uint8Array): Promise<any>;
  review(envelopeId: string): Promise<any>;
  uuid(): string;
}

export async function prepareDraftWithClient(
  input: DraftPdfInput & { recipients: Array<{ name: string; email: string; role: string }> },
  client: DraftClient,
): Promise<any> {
  const created = await client.json('POST', '/api/envelopes', { title: input.title });
  const envelopeId = typeof created?.id === 'string' ? created.id : null;
  if (!envelopeId) throw new Error('TruSign created a draft without returning an envelope id.');

  try {
    const pdf = buildContractDraftPdf(input);
    const filename = `${input.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'contract'}-draft.pdf`;
    const document = await client.pdf(`/api/envelopes/${encodeURIComponent(envelopeId)}/documents`, filename, pdf);
    if (!document?.id) throw new Error('TruSign did not return the uploaded document id.');

    const recipients = input.recipients.map((recipient, index) => ({
      id: client.uuid(),
      name: recipient.name,
      email: recipient.email,
      role: recipient.role,
      routing_order: index + 1,
    }));
    await client.json('PUT', `/api/envelopes/${encodeURIComponent(envelopeId)}/recipients`, { recipients });

    const fields = recipients
      .filter((recipient) => recipient.role === 'signer' || recipient.role === 'approver')
      .map((recipient, index) => ({
        id: client.uuid(),
        document_id: document.id,
        recipient_id: recipient.id,
        page: Number(document.page_count || 1),
        x: 0.12,
        y: Math.min(0.68 + index * 0.07, 0.89),
        w: 0.42,
        h: 0.055,
        type: 'signature',
        required: true,
      }));
    await client.json('PUT', `/api/envelopes/${encodeURIComponent(envelopeId)}/fields`, { fields });
    const review = await client.review(envelopeId);
    if (!review) throw new Error('TruSign draft exists but its review bundle could not be loaded.');
    return review;
  } catch (err) {
    throw new Error(`TruSign draft ${envelopeId} was created but preparation stopped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
