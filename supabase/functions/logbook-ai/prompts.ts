/**
 * What logbook-ai asks Claude about a photo of a page of a post's written logbook, and the JSON it asks
 * for. Claude only copies the attendance lines; the database matches the names to the post's guards and
 * compares the times with the app (section 21 of schema.sql), so no employee record goes to Anthropic.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';

export const MODEL = 'claude-opus-5-5';

const str = { type: 'string' };
export const LOGBOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legibility', 'page_date', 'post_written', 'lines', 'concerns'],
  properties: {
    legibility: { type: 'string', enum: ['clear', 'partly_readable', 'unreadable'] },
    page_date: str,
    post_written: str,
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'employee_no', 'date', 'time_in', 'time_out', 'remarks', 'unclear'],
        properties: {
          name: str,
          employee_no: str,
          date: str,
          time_in: str,
          time_out: str,
          remarks: str,
          unclear: { type: 'boolean' },
        },
      },
    },
    concerns: { type: 'array', items: str },
  },
};

export const LOGBOOK_SYSTEM = `You read a photo of a page of the written logbook kept at a security post in the Philippines. Guards write their name and the time they start and end their duty in it; the client's staff may write or sign in it too. The agency compares what you read with the times the guards logged in its app, so a guard who forgot their phone is still paid, and a duty nobody served is caught.

Copy what is written. Do not guess, and do not complete anything cut off, blurred, crossed out or covered.
- lines: one item per guard per duty, in the order on the page. When a guard's time in and time out are on separate lines, put them together in one item. Leave out lines that are not a guard's attendance: visitors, deliveries, patrols, turnover notes, incidents.
  - name: the guard's name as written, including initials ("J. Dela Cruz"). Empty if there is no name.
  - employee_no: an employee or ID number written for the guard, as written. Empty if none.
  - date: the duty's date as YYYY-MM-DD. A page often gives the date once, at the top or in a header line, for the lines under it. When the year is not written, use the most recent such date on or before today (today's date is in the message). Empty if you cannot tell.
  - time_in and time_out: 24-hour HH:MM ("6:05 PM" is 18:05, "0600H" is 06:00, "6 AM" is 06:00). When AM or PM is not written, use the page's shift pattern (day duties start around 6 or 7 in the morning, night duties in the evening). Empty if not written or not readable.
  - remarks: anything written on the line about this duty (for example "relieved by Santos", "late", "half day"). Empty if none.
  - unclear: true when any part of the line is hard to read or you had to choose between two readings.
- page_date: the date written for the page, as YYYY-MM-DD; empty if none.
- post_written: the post or site named on the page, as written; empty if none.
- legibility: clear, partly_readable (some lines cannot be read), or unreadable.
- concerns: short items on what the agency should look at: times overwritten or corrected, lines crossed out, entries that look added later, the same guard twice for one duty, a page that may be from another post, a photo that cuts off part of the page. An empty list if none.`;

/** Claude reads JPEG, PNG and WebP photos up to 5 MB; not HEIC. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function logbookRequest(base64: string, contentType: ImageType, post: string, today: string): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  return {
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // handwriting: a misread time costs a guard's pay, so Claude takes its time
    output_config: { effort: 'high', format: { type: 'json_schema', schema: LOGBOOK_SCHEMA } },
    system: LOGBOOK_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
        { type: 'text', text: `Today in Manila is ${today}. This page was sent for the post "${post}". Read it as described.` },
      ],
    }],
  };
}
