/** Names are presentation, never CRM or login identifiers. */
export function validateDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter your name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Enter a name between 1 and 120 characters, without control characters.');
  }
  return name;
}
