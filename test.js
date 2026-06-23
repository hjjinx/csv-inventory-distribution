'use strict';
const assert = require('assert');
const {
  getInventoryFromCsv,
  resetDiscrepancies,
  getDiscrepancies,
} = require('./processCsv.js');

// Build the parsedData format that index.js produces: an array of string arrays,
// first row is the header, rest are data rows.
const makeData = (rows) => [
  ['Color', 'Supplier Part Number', 'upload inventory plus return', 'Revenue'],
  ...rows.map(([color, sku, qty, revenue]) => [color, sku, String(qty), String(revenue)]),
];

let passed = 0, failed = 0;
const test = (name, fn) => {
  resetDiscrepancies();
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
};

// ─── Grouping ─────────────────────────────────────────────────────────────────

console.log('\nGrouping');

test('multiple pack sizes for the same product land in one group', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['purple', 'WR60001-1-1_1pcs_INS', 10, 100],
    ['purple', 'WR60001-1-1_2pcs_INS',  5,  80],
    ['purple', 'WR60001-1-1_4pcs_INS',  2,  40],
  ]));
  const group = inv['WR60001-1-1'];
  assert.ok(group, 'group key should be WR60001-1-1');
  assert.strictEqual(Object.keys(group).length, 3);
  assert.strictEqual(group['_1pcs_INS'].quantity, 10);
  assert.strictEqual(group['_2pcs_INS'].quantity,  5);
  assert.strictEqual(group['_4pcs_INS'].quantity,  2);
});

test('different color variants are separate groups', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['pink',   'WR70019-3-17_1pcs_INS', 2, 88],
    ['pink',   'WR70019-3-17_2pcs_INS', 1, 44],
    ['purple', 'WR70019-3-18_1pcs_INS', 4, 60],
    ['purple', 'WR70019-3-18_2pcs_INS', 2, 30],
  ]));
  assert.ok(inv['WR70019-3-17'], 'group 17 should exist');
  assert.ok(inv['WR70019-3-18'], 'group 18 should exist');
  assert.strictEqual(Object.keys(inv).length, 2);
});

test('product 10 and product 1 are separate groups regardless of file order (10 first)', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['pink', 'WR60001-1-10_1pcs_INS', 3, 60],
    ['pink', 'WR60001-1-10_2pcs_INS', 2, 40],
    ['blue', 'WR60001-1-1_1pcs_INS',  5, 80],
    ['blue', 'WR60001-1-1_2pcs_INS',  3, 50],
  ]));
  assert.ok(inv['WR60001-1-10'], 'group 10 should exist');
  assert.ok(inv['WR60001-1-1'],  'group 1 should exist');
  assert.strictEqual(Object.keys(inv).length, 2);
});

test('product 10 and product 1 are separate groups regardless of file order (1 first)', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['blue', 'WR60001-1-1_1pcs_INS',  5, 80],
    ['blue', 'WR60001-1-1_2pcs_INS',  3, 50],
    ['pink', 'WR60001-1-10_1pcs_INS', 3, 60],
    ['pink', 'WR60001-1-10_2pcs_INS', 2, 40],
  ]));
  assert.ok(inv['WR60001-1-1'],  'group 1 should exist');
  assert.ok(inv['WR60001-1-10'], 'group 10 should exist');
  assert.strictEqual(Object.keys(inv).length, 2);
});

// ─── A-variant handling ───────────────────────────────────────────────────────

console.log('\nA-variant handling');

test('A-variant joins the same group as its non-A counterpart', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['purple', 'WR60001-1-1_1pcs_INS',  10, 100],
    ['purple', 'WR60001-1-1_2pcs_INS',   5,  80],
    ['purple', 'WR60001-1-1A_1pcs_INS',  3,  30],
  ]));
  assert.ok(inv['WR60001-1-1'], 'group WR60001-1-1 should exist');
  assert.ok(!inv['WR60001-1-1A'], 'WR60001-1-1A must not be a separate group');
  assert.strictEqual(Object.keys(inv).length, 1);
});

test('A-variant gets a distinct variation key — it is not merged with the non-A slot', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['purple', 'WR60001-1-1_1pcs_INS',  10, 100],
    ['purple', 'WR60001-1-1A_1pcs_INS',  5,  50],
  ]));
  const group = inv['WR60001-1-1'];
  assert.ok(group['_1pcs_INS'],  '_1pcs_INS variation should exist');
  assert.ok(group['A_1pcs_INS'], 'A_1pcs_INS should be a separate variation slot');
  assert.strictEqual(group['_1pcs_INS'].quantity,  10);
  assert.strictEqual(group['A_1pcs_INS'].quantity,  5);
});

test('output SKUs for A-variants are reconstructed exactly from parent + variation', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['purple', 'WR60001-1-1_1pcs_INS',  10, 100],
    ['purple', 'WR60001-1-1A_1pcs_INS',  5,  50],
  ]));
  const group = inv['WR60001-1-1'];
  const parent = group['_1pcs_INS'].parent;
  assert.strictEqual(parent + '_1pcs_INS',  'WR60001-1-1_1pcs_INS');
  assert.strictEqual(parent + 'A_1pcs_INS', 'WR60001-1-1A_1pcs_INS');
});

test('A-variant separated from its non-A counterpart by other products is still grouped correctly', () => {
  // Simulates the real-file ordering where WR60001-2-1A appears after products 10–18.
  const [inv] = getInventoryFromCsv(makeData([
    ['yellow', 'WR60001-2-1_2pcs_COV',  5, 80],
    ['blue',   'WR60001-2-10_2pcs_COV', 3, 60],
    ['wine',   'WR60001-2-11_2pcs_COV', 2, 40],
    ['yellow', 'WR60001-2-1A_1pcs_INS', 4, 30],
  ]));
  assert.ok(inv['WR60001-2-1'],  'WR60001-2-1 group should exist');
  assert.ok(inv['WR60001-2-10'], 'WR60001-2-10 group should exist');
  assert.ok(inv['WR60001-2-11'], 'WR60001-2-11 group should exist');
  assert.strictEqual(Object.keys(inv['WR60001-2-1']).length, 2, 'WR60001-2-1 should have 2 variations');
  assert.ok(inv['WR60001-2-1']['_2pcs_COV'],  '_2pcs_COV should be in WR60001-2-1');
  assert.ok(inv['WR60001-2-1']['A_1pcs_INS'], 'A_1pcs_INS should be in WR60001-2-1');
});

// ─── Format variety ───────────────────────────────────────────────────────────

console.log('\nFormat variety');

test('COV-embedded all-dash SKU groups with underscore and A-variant rows', () => {
  // testinventory40.csv pattern: three different separator styles for one product.
  const [inv] = getInventoryFromCsv(makeData([
    ['pink', 'WR70019-3-17_1pcs_INS',   2, 88.98],
    ['pink', 'WR70019-3-17A_2pcs_INS', 14, 0],
    ['pink', 'WR70019-3-17-COV-2pcs',   6, 0],
  ]));
  const group = inv['WR70019-3-17'];
  assert.ok(group, 'group WR70019-3-17 should exist');
  assert.ok(group['_1pcs_INS'],  '_1pcs_INS variation should exist');
  assert.ok(group['A_2pcs_INS'], 'A_2pcs_INS variation should exist');
  assert.ok(group['-COV-2pcs'],  '-COV-2pcs variation should exist');
  assert.strictEqual(Object.keys(group).length, 3);
});

test('mixed underscore/dash delimiters on the same product land in one group', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['black', 'WR60030A-1-1_2pcs_COV', 4, 60],
    ['black', 'WR60030A-1-1-1pcs_COV', 8, 100],
  ]));
  const group = inv['WR60030A-1-1'];
  assert.ok(group, 'group WR60030A-1-1 should exist');
  assert.ok(group['_2pcs_COV'], '_2pcs_COV variation should exist');
  assert.ok(group['-1pcs_COV'], '-1pcs_COV variation should exist');
});

test('all-dash COV and INS variants form one group', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['white', 'WR60036-3-1-COV-1pcs', 3, 50],
    ['white', 'WR60036-3-1-COV-2pcs', 2, 40],
    ['white', 'WR60036-3-1-INS-1pcs', 5, 70],
    ['white', 'WR60036-3-1-INS-2pcs', 1, 30],
  ]));
  const group = inv['WR60036-3-1'];
  assert.ok(group, 'group WR60036-3-1 should exist');
  assert.strictEqual(Object.keys(group).length, 4);
  assert.ok(group['-COV-1pcs']);
  assert.ok(group['-COV-2pcs']);
  assert.ok(group['-INS-1pcs']);
  assert.ok(group['-INS-2pcs']);
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

console.log('\nEdge cases');

test('standalone SKU with no parseable variation is flagged as a discrepancy', () => {
  const [, invalidRows] = getInventoryFromCsv(makeData([
    ['black', 'WR60001-1-1', 5, 100],
  ]));
  const d = getDiscrepancies();
  assert.strictEqual(invalidRows.length, 1);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].reason, 'Variation');
});

test('exact duplicate SKUs have their quantities and revenues merged', () => {
  const [inv] = getInventoryFromCsv(makeData([
    ['purple', 'WR60001-1-1_1pcs_INS', 10, 100],
    ['purple', 'WR60001-1-1_1pcs_INS',  5,  50], // exact duplicate
    ['purple', 'WR60001-1-1_2pcs_INS',  3,  60],
  ]));
  const group = inv['WR60001-1-1'];
  assert.strictEqual(group['_1pcs_INS'].quantity, 15);  // 10 + 5
  assert.strictEqual(group['_1pcs_INS'].revenue,  150); // 100 + 50
});

test('rows with fewer than 4 columns are skipped and counted as invalid', () => {
  const data = [
    ['Color', 'Supplier Part Number', 'upload inventory plus return', 'Revenue'],
    ['purple', 'WR60001-1-1_1pcs_INS'],                        // only 2 columns — invalid
    ['purple', 'WR60001-1-1_2pcs_INS', '5', '80'],             // valid
    ['purple', 'WR60001-1-1_4pcs_INS', '2', '40'],             // valid sibling
  ];
  const [, invalidRows] = getInventoryFromCsv(data);
  assert.strictEqual(invalidRows.length, 1); // only the short-column row
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
