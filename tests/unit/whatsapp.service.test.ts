import { WhatsAppService } from '../../src/services/whatsapp.service';

describe('WhatsAppService.parseQuoteFromReply', () => {
  const cases: [string, number | null][] = [
    // Plain numbers
    ['6500',          6500],
    ['65000',         65000],
    ['6,500',         6500],
    ['6,500.00',      6500],
    // With currency symbol
    ['₦6500',         6500],
    ['₦6,500',        6500],
    // Shorthand
    ['15k',           15000],
    ['15K',           15000],
    ['1.5k',          1500],
    // With surrounding text
    ['I charge 8000 for that', 8000],
    ['my price is ₦12,000 including materials', 12000],
    // Invalid / non-price replies
    ['sure, let me check', null],
    ['ok', null],
    ['',   null],
    // Ambiguous but should still parse
    ['20000 naira',   20000],
  ];

  test.each(cases)('parseQuoteFromReply(%s) → %s', (input, expected) => {
    expect(WhatsAppService.parseQuoteFromReply(input)).toBe(expected);
  });
});
