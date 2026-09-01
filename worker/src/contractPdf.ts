// Hand-rolled PDF-1.4 writer for free-text contract drafts — ported verbatim
// from TRU OS's contractPdf.mjs, zero dependencies. Every page is stamped
// "DRAFT - NOT SENT - Eric review required" so a draft can never pass for a
// finished contract even if the file escapes the review screen.

export interface DraftPdfInput {
  title: string;
  client: string;
  team: string | null;
  contractType: string;
  templateId: string | null;
  durationDays: number | null;
  terms: string;
  fields?: Record<string, string>;
  draftText: string;
  recipients?: Array<{ name: string; email?: string; role?: string }>;
}

function ascii(value: unknown): string {
  return String(value ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

function escapePdf(value: unknown): string {
  return ascii(value).replace(/([\\()])/g, '\\$1');
}

function wrapLine(line: string, width: number): string[] {
  if (!line.trim()) return [''];
  const words = line.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pageStream(lines: string[], pageNumber: number, pageCount: number): string {
  const commands = [
    'BT',
    '/F1 10 Tf',
    '12 TL',
    '54 744 Td',
    `(DRAFT - NOT SENT - Eric review required) Tj`,
    '0 -24 Td',
  ];
  for (const line of lines) {
    commands.push(`(${escapePdf(line)}) Tj`, '0 -12 Td');
  }
  commands.push('ET', 'BT', '/F1 8 Tf', `54 30 Td`, `(Page ${pageNumber} of ${pageCount}) Tj`, 'ET');
  return commands.join('\n');
}

/** Build a small, standards-compliant Letter PDF without a runtime dependency. */
export function buildContractDraftPdf({
  title, client, team, contractType, templateId, durationDays, terms, fields = {}, draftText, recipients = [],
}: DraftPdfInput): Uint8Array {
  const source = [
    ascii(title).toUpperCase(),
    '',
    `Client: ${client}`,
    `Team: ${team || 'Not specified'}`,
    `Contract type: ${contractType}`,
    `Template: ${templateId || 'No TruSign template endpoint; drafted from supplied text'}`,
    `Duration: ${durationDays ? `${durationDays} days` : 'Not specified'}`,
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    '',
    'SUPPLIED TERMS',
    ...ascii(terms).split(/\r?\n/),
    '',
    'DRAFT CONTRACT',
    ...ascii(draftText).split(/\r?\n/),
    '',
    'SIGNATURES',
    ...recipients.flatMap((recipient) => [
      '',
      `${recipient.name} (${recipient.role || 'signer'})`,
      'Signature: ____________________________________',
      'Date: _________________________________________',
    ]),
  ];
  const wrapped = source.flatMap((line) => wrapLine(line, 88));
  const perPage = 50;
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length || i === 0; i += perPage) pages.push(wrapped.slice(i, i + perPage));

  const objects = new Map<number, string>();
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = pageStream(lines, index + 1, pages.length);
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  const maxId = Math.max(...objects.keys());
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = new TextEncoder().encode(pdf).length;
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
