/** Follow Up Boss hands phones back however the agent typed them — some with
 *  dashes, some bare digits, some with +1 or (parens). One shape on screen:
 *  555-204-8817. Anything that isn't a plain US ten-digit number (extensions,
 *  international) is shown exactly as it came rather than mangled. */
export function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw.trim() || null;
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}
