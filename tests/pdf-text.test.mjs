// The text rule for certificate PDFs (src/lib/pdfText.ts). Run: npm run test:pdf
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latin1 } from '../src/lib/pdfText.ts';

test('the peso sign is written as PHP, which the standard PDF fonts can draw', () => {
  assert.equal(latin1("The employee's compensation is ₱540.00 a day."), "The employee's compensation is PHP 540.00 a day.");
  assert.equal(latin1('₱ 1,000 and ₱2,500.50'), 'PHP 1,000 and PHP 2,500.50');
});

test('Latin-1 letters stay; other letters lose their accents; anything else becomes ?', () => {
  assert.equal(latin1('Peña, Ñino, Gödöllő'), 'Peña, Ñino, Gödöllo');
  assert.equal(latin1('Done ✓'), 'Done ?');
  assert.equal(latin1('BEA LIM'), 'BEA LIM');
});
