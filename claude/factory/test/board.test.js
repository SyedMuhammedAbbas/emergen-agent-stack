'use strict';
// node claude/factory/test/board.test.js  - offline checks for dashboard/board.js (no Odoo calls).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { plain, matchers, queueBuckets } = require('../dashboard/board');

// HTML is reduced to text: tags and scripts gone, entities decoded, never re-interpreted as markup
assert.strictEqual(plain('<p>a &amp; b</p><script>alert(1)</script><p>c&nbsp;d</p>'), 'a & b\nc d');
assert.strictEqual(plain('<ul><li>one</li><li>two</li></ul>'), '- one\n- two');
assert.strictEqual(plain('&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>'); // text, rendered with textContent/esc by the page
assert.strictEqual(plain(false), '');

// id matching: digit boundaries, so ticket 37 does not match branch ticket-371
const m = matchers({ id: 28608, ticket: 37, title: 'EME-1241: x' });
assert.ok(m.branch.test('agent/EME-1241-odoo-28608-fix'));
assert.ok(m.branch.test('task/ticket-37-foo'));
assert.ok(!m.branch.test('task/ticket-371-foo'));
assert.ok(!m.branch.test('agent/EME-12410-foo'));
assert.ok(m.text.test('working on Ticket#37 now'));
assert.ok(m.text.test('odoo 28608'));
assert.ok(!m.text.test('size 286089 bytes'));

// work-queue.md buckets (heading, table cell and inline forms)
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wq-')), 'work-queue.md');
fs.writeFileSync(f, '## Bucket A\n- Ticket#371 fix\n## B - later\n- EME-5 thing\n## Notes\n- Ticket#9\n| Ticket#12 | C |\n');
const q = queueBuckets(f);
assert.strictEqual(q.get('t371'), 'A');
assert.strictEqual(q.get('e5'), 'B');
assert.strictEqual(q.get('t9'), undefined);
assert.strictEqual(q.get('t12'), 'C');
console.log('board tests passed');
