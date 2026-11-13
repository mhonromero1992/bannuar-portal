/**
 * What document-ai asks Claude about an uploaded document (the LESP to start with), and the JSON it asks
 * for. Claude copies what is printed; the function then compares the name and the expiry itself.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';

export const MODEL = 'claude-opus-5-5';

const str = { type: 'string' };
export const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches_type', 'legibility', 'holder_name', 'document_no', 'issued_on', 'expires_on', 'issuer', 'concerns'],
  properties: {
    matches_type: { type: 'boolean' },
    legibility: { type: 'string', enum: ['clear', 'partly_readable', 'unreadable'] },
    holder_name: str,
    document_no: str,
    issued_on: str,
    expires_on: str,
    issuer: str,
    concerns: { type: 'array', items: str },
  },
};

export function documentSystem(typeName: string): string {
  return `You read a photo or scan of a document that a security guard in the Philippines sent to their agency's HR. It should be: ${typeName}. HR uses what you read to fill in the record and to spot problems early; HR still checks the document itself.

Copy what is printed, exactly. Do not guess or complete anything that is cut off, blurred or covered.
- matches_type: whether this is that kind of document. A License to Exercise Security Profession (LESP) is issued by the PNP's Supervisory Office for Security and Investigation Agencies (SOSIA).
- legibility: clear, partly_readable (some fields cannot be read), or unreadable.
- holder_name: the holder's name as printed.
- document_no: the license or document number as printed.
- issued_on and expires_on: as YYYY-MM-DD, converted from the printed date (for example "March 5, 2027" is 2027-03-05). An empty string when not shown or not readable.
- issuer: the issuing office as printed.
- concerns: short items on anything HR should look at: key fields cut off or under glare, signs of editing, fields that disagree with each other, a photo of a screen or a photocopy instead of the document, or a document that is not the one expected. An empty list if none.

You cannot confirm that a document is genuine; never say that it is.`;
}

/** Claude reads JPEG, PNG and WebP photos (up to 5 MB) and PDFs; not HEIC. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function documentRequest(
  base64: string,
  contentType: string,
  typeName: string,
): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const file: Anthropic.Beta.Messages.BetaContentBlockParam = contentType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: contentType as (typeof IMAGE_TYPES)[number], data: base64 } };
  return {
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DOCUMENT_SCHEMA } },
    system: documentSystem(typeName),
    messages: [{ role: 'user', content: [file, { type: 'text', text: 'Read this document as described.' }] }],
  };
}
