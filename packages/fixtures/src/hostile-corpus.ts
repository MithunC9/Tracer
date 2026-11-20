/**
 * Hostile redaction corpus shared by the TS reference redactor and the Rust agent
 * (written to data/hostile-corpus.json by `pnpm generate`).
 *
 * Contract for a redactor R: for every item, R(input) must contain NONE of
 * `mustNotContain` and ALL of `mustContain`. `category` is informational only.
 * All secrets below are fake / public test values.
 */
export interface HostileCase {
  input: string;
  mustNotContain: string[];
  mustContain?: string[];
  category: string;
}

// Built from parts so that this source file itself does not trip secret scanners
// on literal provider tokens; the generated JSON contains the joined strings.
const j = (...p: string[]) => p.join('');

export const HOSTILE_CORPUS: HostileCase[] = [
  // ---- payment cards (Luhn-valid) ----
  { category: 'card', input: 'Card on file: 4111 1111 1111 1111 exp 12/28', mustNotContain: ['4111 1111 1111 1111', '1111 1111 1111'], mustContain: ['exp 12/28'] },
  { category: 'card', input: 'charge 4242-4242-4242-4242 failed', mustNotContain: ['4242-4242-4242-4242', '4242-4242'], mustContain: ['failed'] },
  { category: 'card', input: 'cc=5555555555554444;', mustNotContain: ['5555555555554444'] },
  { category: 'card', input: 'Amex 3782 822463 10005 (corporate)', mustNotContain: ['3782 822463 10005', '822463'], mustContain: ['(corporate)'] },
  { category: 'card', input: 'Amex no spaces 378282246310005', mustNotContain: ['378282246310005'] },
  { category: 'card', input: 'Discover: 6011-1111-1111-1117', mustNotContain: ['6011-1111-1111-1117'] },
  { category: 'card', input: 'MC 5105 1051 0510 5100 cvv 123', mustNotContain: ['5105 1051 0510 5100'] },
  { category: 'card', input: 'card4000056655665556end', mustNotContain: ['4000056655665556'] },
  { category: 'card', input: 'Diners 3056 9309 0259 04 ok', mustNotContain: ['3056 9309 0259 04'] },
  { category: 'card', input: 'JCB 3530111333300000 approved', mustNotContain: ['3530111333300000'], mustContain: ['approved'] },
  // ---- Luhn-FAILING numbers: must survive untouched ----
  { category: 'card-negative', input: 'Ref 4111 1111 1111 1112 is not a card', mustNotContain: ['[REDACTED:card_number]'], mustContain: ['4111 1111 1111 1112'] },
  { category: 'card-negative', input: 'Order number 1234567890123456 shipped', mustNotContain: ['[REDACTED'], mustContain: ['1234567890123456'] },
  { category: 'card-negative', input: 'Tracking 9400 1000 0000 0000 0000 01', mustNotContain: ['[REDACTED:card_number]'], mustContain: ['9400 1000'] },
  { category: 'card-negative', input: 'Account 5555-5555-5555-5555 (test, invalid)', mustNotContain: ['[REDACTED:card_number]'], mustContain: ['5555-5555-5555-5555'] },
  // ---- SSNs ----
  { category: 'ssn', input: 'SSN 123-45-6789 on W-9', mustNotContain: ['123-45-6789'], mustContain: ['W-9'] },
  { category: 'ssn', input: 'ssn: 078 05 1120', mustNotContain: ['078 05 1120'] },
  { category: 'ssn', input: 'Social Security Number: 219099999', mustNotContain: ['219099999'] },
  { category: 'ssn', input: 'TIN 536.22.1471 (contractor)', mustNotContain: ['536.22.1471'], mustContain: ['(contractor)'] },
  { category: 'ssn', input: 'SS# 401-77-2310', mustNotContain: ['401-77-2310'] },
  { category: 'ssn-negative', input: 'Date 2026-11-02 and room 000-00-0000', mustNotContain: ['[REDACTED:ssn]'], mustContain: ['2026-11-02'] },
  // ---- emails ----
  { category: 'email', input: 'From: jane.doe+billing@acme.co', mustNotContain: ['jane.doe+billing@acme.co', 'jane.doe'] },
  { category: 'email', input: 'cc ops@mail.eu.example-corp.com, a_b@x.io', mustNotContain: ['ops@mail.eu.example-corp.com', 'a_b@x.io'] },
  { category: 'email', input: 'Reply to "Maya K." <maya.k@studio-kraft.de>', mustNotContain: ['maya.k@studio-kraft.de'], mustContain: ['Maya K.'] },
  { category: 'email', input: 'UPPER.CASE@EXAMPLE.ORG wrote:', mustNotContain: ['UPPER.CASE@EXAMPLE.ORG'], mustContain: ['wrote:'] },
  { category: 'email-negative', input: 'ping @sarah in #ops about v2@latest', mustContain: ['@sarah', '#ops'], mustNotContain: [] },
  // ---- phone numbers ----
  { category: 'phone', input: 'Call (415) 555-0132 after 3pm', mustNotContain: ['555-0132', '(415)'], mustContain: ['after 3pm'] },
  { category: 'phone', input: 'mobile 415-555-0199', mustNotContain: ['415-555-0199'] },
  { category: 'phone', input: 'tel 415.555.0175', mustNotContain: ['415.555.0175'] },
  { category: 'phone', input: 'Toll free 1-800-555-0100', mustNotContain: ['800-555-0100'] },
  { category: 'phone', input: 'US +1 (212) 555-0147', mustNotContain: ['555-0147'] },
  { category: 'phone', input: 'London +44 20 7946 0958', mustNotContain: ['7946 0958', '+44 20'] },
  { category: 'phone', input: 'Berlin +49 30 901820 ext', mustNotContain: ['901820'] },
  { category: 'phone', input: 'Paris +33 1 42 68 53 00', mustNotContain: ['42 68 53 00'] },
  { category: 'phone', input: 'India +91 98765 43210', mustNotContain: ['98765 43210'] },
  { category: 'phone', input: 'Tokyo +81 3-1234-5678', mustNotContain: ['1234-5678'] },
  { category: 'phone', input: 'AU +61-2-9374-4000', mustNotContain: ['9374-4000'] },
  // ---- IBANs (mod-97 valid) ----
  { category: 'iban', input: 'IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX', mustNotContain: ['DE89 3704 0044 0532 0130 00', '0532 0130'], mustContain: ['BIC'] },
  { category: 'iban', input: 'pay to GB82WEST12345698765432 by Friday', mustNotContain: ['GB82WEST12345698765432'], mustContain: ['by Friday'] },
  { category: 'iban', input: 'FR14 2004 1010 0505 0001 3M02 606', mustNotContain: ['FR14 2004', '3M02 606'] },
  { category: 'iban', input: 'NL91 ABNA 0417 1643 00 (Rabo)', mustNotContain: ['NL91 ABNA 0417 1643 00'] },
  { category: 'iban', input: 'CH93 0076 2011 6238 5295 7', mustNotContain: ['CH93 0076 2011 6238 5295 7'] },
  { category: 'iban', input: 'ES9121000418450200051332 EUR', mustNotContain: ['ES9121000418450200051332'], mustContain: ['EUR'] },
  // ---- API keys by known prefix ----
  { category: 'api_key', input: j('STRIPE_SECRET_KEY=sk_', 'live_', '51Hc9xQ2eZvKYlo2C8Tz3kLm9Pq'), mustNotContain: [j('sk_', 'live_', '51Hc9xQ2eZvKYlo2C8Tz3kLm9Pq'), '51Hc9xQ2'] },
  { category: 'api_key', input: j('restricted rk_', 'live_', '4eC39HqLyjWDarjtT1zdp7dc'), mustNotContain: ['4eC39HqLyjWDarjtT1zdp7dc'] },
  { category: 'api_key', input: j('webhook whsec_', 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'), mustNotContain: ['MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'] },
  { category: 'api_key', input: j('git push https://x:gh', 'p_', 'R7tN2kQ9vXc4LmP8sD1fG6hJ3aZ0wE5yU7iO@github.com/acme/app'), mustNotContain: ['R7tN2kQ9vXc4LmP8sD1fG6hJ3aZ0wE5yU7iO'] },
  { category: 'api_key', input: j('token gh', 'o_', '16C7e42F292c6912E7710c838347Ae178B4a'), mustNotContain: ['16C7e42F292c6912E7710c838347Ae178B4a'] },
  { category: 'api_key', input: j('github_', 'pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEF'), mustNotContain: ['11ABCDEFG0123456789_abcdef'] },
  { category: 'api_key', input: j('aws_access_key_id = AK', 'IA', 'IOSFODNN7EXAMPLE'), mustNotContain: [j('AK', 'IA', 'IOSFODNN7EXAMPLE')] },
  { category: 'api_key', input: 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', mustNotContain: ['wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'] },
  { category: 'api_key', input: j('SLACK_BOT_TOKEN=xo', 'xb-', '2400000000000-2410000000000-AbCdEfGhIjKlMnOpQrStUvWx'), mustNotContain: ['AbCdEfGhIjKlMnOpQrStUvWx', '2400000000000'] },
  { category: 'api_key', input: j('user token xo', 'xp-', '1234567890-0987654321-1122334455-abcdef0123456789abcdef0123456789'), mustNotContain: ['abcdef0123456789abcdef0123456789'] },
  { category: 'api_key', input: j('OPENAI_API_KEY="sk-', 'proj-', 'Xy3kT9mN2pQ8rL5vW1zA7bC4dE6fG0hJ_kLmNoPqRsT"'), mustNotContain: ['Xy3kT9mN2pQ8rL5vW1zA7bC4dE6fG0hJ'] },
  { category: 'api_key', input: j('legacy sk-', 'T3BlbkFJ9aZ8yX7wV6uT5sR4qP3oN2mL1kJ'), mustNotContain: ['T3BlbkFJ9aZ8yX7wV6uT5sR4qP3oN2mL1kJ'] },
  { category: 'api_key', input: j('ANTHROPIC_API_KEY=sk-', 'ant-', 'api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AA'), mustNotContain: ['AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'] },
  { category: 'api_key', input: j('maps key AI', 'za', 'SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'), mustNotContain: ['SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'] },
  { category: 'api_key', input: j('SENDGRID=SG', '.', 'ngeVfQFYQlKU0ufo8x5d1A.TwL2iGABf9DHoTf-09kqeF8tAmbihYzrnopKc-1s5cr'), mustNotContain: ['ngeVfQFYQlKU0ufo8x5d1A', 'TwL2iGABf9DHoTf'] },
  { category: 'api_key', input: j('glpat-', 'xxRtY7uIoP0aSdFgHjKl'), mustNotContain: ['xxRtY7uIoP0aSdFgHjKl'] },
  { category: 'api_key', input: 'client_secret: 9f8e7d6c5b4a', mustNotContain: ['9f8e7d6c5b4a'] },
  { category: 'api_key', input: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn\n-----END RSA PRIVATE KEY-----', mustNotContain: ['MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn'] },
  // ---- JWTs and opaque tokens ----
  {
    category: 'jwt',
    input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    mustNotContain: ['eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'],
    mustContain: ['Authorization: Bearer'],
  },
  { category: 'token', input: 'session=dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZSAxMjM0NTY3ODk=', mustNotContain: ['dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZSAxMjM0NTY3ODk'] },
  { category: 'token', input: 'reset link token Zq8vR2mX9kL4pT7wB1nY6cJ3hF0sD5gA in email', mustNotContain: ['Zq8vR2mX9kL4pT7wB1nY6cJ3hF0sD5gA'], mustContain: ['in email'] },
  { category: 'token', input: 'hex secret 3f9a2c1e8b7d6054a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6', mustNotContain: ['3f9a2c1e8b7d6054a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6'] },
  { category: 'token', input: 'payout po_1OaBcDeFgHiJkLmNoPqRsTuV arrived', mustNotContain: ['1OaBcDeFgHiJkLmNoPqRsTuV'], mustContain: ['arrived'] },
  // ---- secrets inside URLs ----
  { category: 'url', input: 'https://dashboard.stripe.com/payouts/po_1Nx?account=acct_12345&token=abc', mustNotContain: ['/payouts/po_1Nx', 'token=abc', 'acct_12345'], mustContain: ['dashboard.stripe.com'] },
  { category: 'url', input: 'Open https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit#gid=0 now', mustNotContain: ['1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd', 'gid=0'], mustContain: ['docs.google.com', 'now'] },
  { category: 'url', input: 'remote https://deploy:hunter2secret@git.example.com/acme/app.git', mustNotContain: ['hunter2secret', 'deploy:', '/acme/app.git'], mustContain: ['git.example.com'] },
  // ---- passwords ----
  { category: 'password', input: 'password: Tr0ub4dor&3 (temp)', mustNotContain: ['Tr0ub4dor&3'], mustContain: ['(temp)'] },
  { category: 'password', input: 'wifi pwd=correct-horse-battery', mustNotContain: ['correct-horse-battery'] },
  // ---- benign look-alikes that MUST survive ----
  { category: 'benign', input: 'Invoice INV-2026-0042 total $1,234.56 due 2026-11-30', mustNotContain: ['[REDACTED'], mustContain: ['INV-2026-0042', '$1,234.56', '2026-11-30'] },
  { category: 'benign', input: 'Order #100234 shipped via UPS', mustNotContain: ['[REDACTED'], mustContain: ['#100234'] },
  { category: 'benign', input: 'Release v2.14.3 (build 20261102.4) on macOS 15.1.1', mustNotContain: ['[REDACTED'], mustContain: ['v2.14.3', '20261102.4', '15.1.1'] },
  { category: 'benign', input: 'Meeting 09:30-10:15 on 11/02/2026 in Room 3-205', mustNotContain: ['[REDACTED'], mustContain: ['09:30-10:15', '11/02/2026', '3-205'] },
  { category: 'benign', input: 'request id 3f2504e0-4f89-11d3-9a0c-0305e82c3301', mustNotContain: ['[REDACTED'], mustContain: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'] },
  { category: 'benign', input: 'File q3-2026-board-deck-final-v2.pdf uploaded', mustNotContain: ['[REDACTED'], mustContain: ['q3-2026-board-deck-final-v2.pdf'] },
  { category: 'benign', input: 'Revenue up +15% to 48,250 units; NPS 72', mustNotContain: ['[REDACTED'], mustContain: ['+15%', '48,250'] },
  { category: 'benign', input: 'Server 192.168.10.24:8080 healthy', mustNotContain: ['[REDACTED'], mustContain: ['192.168.10.24:8080'] },
  { category: 'benign', input: 'PO-88231-B and ticket #48213 (priority 2)', mustNotContain: ['[REDACTED'], mustContain: ['PO-88231-B', '#48213'] },
  { category: 'benign', input: 'ZIP 94107-1234, Suite 400', mustNotContain: ['[REDACTED'], mustContain: ['94107-1234'] },
  { category: 'benign', input: 'Supercalifragilisticexpialidocious_is_long_but_harmless', mustNotContain: ['[REDACTED'], mustContain: ['Supercalifragilisticexpialidocious'] },
  { category: 'benign', input: 'task-list sk-ating desk_live_feed', mustNotContain: ['[REDACTED'], mustContain: ['task-list', 'desk_live_feed'] },
  { category: 'benign', input: 'Q4 budget: 12 500 EUR, 3 400 GBP', mustNotContain: ['[REDACTED'], mustContain: ['12 500 EUR'] },
  { category: 'benign', input: 'See github.com/acme/app/pull/482 for details', mustNotContain: ['[REDACTED'], mustContain: ['github.com/acme/app/pull/482'] },
  { category: 'benign', input: 'Timer 01:45:12 — Client: Nordlicht GmbH', mustNotContain: ['[REDACTED'], mustContain: ['01:45:12', 'Nordlicht GmbH'] },
  { category: 'benign', input: 'ISBN 978-0-306-40615-7', mustNotContain: ['[REDACTED'], mustContain: ['978-0-306-40615-7'] },
  // ---- mixed ----
  {
    category: 'mixed',
    input: 'Hi, it is Dana (dana@client.io, +1 646 555 0123). Card 4111111111111111, SSN 123-45-6789, IBAN GB82 WEST 1234 5698 7654 32. Order #5521 thanks!',
    mustNotContain: ['dana@client.io', '646 555 0123', '4111111111111111', '123-45-6789', 'GB82 WEST'],
    mustContain: ['Hi, it is Dana', 'Order #5521', 'thanks!'],
  },
];
