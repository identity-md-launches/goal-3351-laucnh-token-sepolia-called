// Focused tests for site/lib.js (pure encoding/parsing/validation logic).
// Run with: node site/tests/lib.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const L = require(path.join(__dirname, "..", "lib.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok   -", name);
  } catch (e) {
    failed++;
    console.log("FAIL -", name, "\n       ", e.message);
  }
}

// --- amount parsing: exact decimal / base-unit conversion, no floats ---
test("parseUnits: whole number", () => {
  assert.strictEqual(L.parseUnits("100", 18).toString(), "100000000000000000000");
});
test("parseUnits: fractional amount", () => {
  assert.strictEqual(L.parseUnits("12.5", 18).toString(), "12500000000000000000");
});
test("parseUnits: full 18-decimal precision preserved exactly", () => {
  // 0.1 + 0.2 famously is not exact in floating point; must be exact here.
  const a = L.parseUnits("0.1", 18);
  const b = L.parseUnits("0.2", 18);
  assert.strictEqual((a + b).toString(), "300000000000000000");
});
test("parseUnits: rejects too many decimal places", () => {
  assert.throws(() => L.parseUnits("1.1234567890123456789", 18));
});
test("parseUnits: rejects non-numeric input", () => {
  assert.throws(() => L.parseUnits("abc", 18));
  assert.throws(() => L.parseUnits("1e5", 18));
  assert.throws(() => L.parseUnits("-1", 18));
});
test("formatUnits: round-trips exactly", () => {
  const base = L.parseUnits("1234.000000000000000001", 18);
  assert.strictEqual(L.formatUnits(base, 18), "1234.000000000000000001");
});
test("formatUnits: zero and small values", () => {
  assert.strictEqual(L.formatUnits(0n, 18), "0");
  assert.strictEqual(L.formatUnits(1n, 18), "0.000000000000000001");
});

// --- deployment.json validation ---
test("validateDeployment: correct not-deployed-yet record", () => {
  const r = L.validateDeployment({ chainId: 11155111, token: null, staking: null });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.deployed, false);
});
test("validateDeployment: valid deployed record", () => {
  const addr1 = "0x" + "1".repeat(40);
  const addr2 = "0x" + "2".repeat(40);
  const r = L.validateDeployment({ chainId: 11155111, token: addr1, staking: addr2 });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.deployed, true);
  assert.strictEqual(r.token, addr1);
});
test("validateDeployment: wrong chainId is rejected", () => {
  const r = L.validateDeployment({ chainId: 1, token: null, staking: null });
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes("chainId")));
});
test("validateDeployment: malformed address is rejected, not silently accepted", () => {
  const r = L.validateDeployment({ chainId: 11155111, token: "not-an-address", staking: null });
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.token, null);
});
test("validateDeployment: null / non-object input never throws", () => {
  assert.strictEqual(L.validateDeployment(null).valid, false);
  assert.strictEqual(L.validateDeployment(undefined).valid, false);
  assert.strictEqual(L.validateDeployment("garbage").valid, false);
  assert.strictEqual(L.validateDeployment([1, 2, 3]).valid, false);
});
test("validateDeployment: missing fields treated as malformed", () => {
  const r = L.validateDeployment({});
  assert.strictEqual(r.valid, false);
});

// --- address validation ---
test("isValidAddress: accepts well-formed addresses only", () => {
  assert.strictEqual(L.isValidAddress("0x" + "a".repeat(40)), true);
  assert.strictEqual(L.isValidAddress("0x" + "a".repeat(39)), false);
  assert.strictEqual(L.isValidAddress("not-hex"), false);
  assert.strictEqual(L.isValidAddress(null), false);
  assert.strictEqual(L.isValidAddress(123), false);
});

// --- ABI encoding/decoding ---
test("encodeUint256Arg / decodeUint256 round trip", () => {
  const hex = L.encodeUint256Arg(123456789n);
  assert.strictEqual(hex.length, 64);
  assert.strictEqual(L.decodeUint256("0x" + hex).toString(), "123456789");
});
test("encodeUint256Arg: rejects negative and overflow", () => {
  assert.throws(() => L.encodeUint256Arg(-1n));
  assert.throws(() => L.encodeUint256Arg((2n ** 256n)));
});
test("encodeAddressArg / decodeAddress round trip", () => {
  const addr = "0xabababababababababababababababababababab".slice(0, 42);
  const hex = L.encodeAddressArg(addr);
  assert.strictEqual(L.decodeAddress("0x" + hex), addr.toLowerCase());
});
test("encodeAddressArg: rejects invalid address", () => {
  assert.throws(() => L.encodeAddressArg("0xshort"));
});
test("encodeCall: selectors match known, independently-verifiable 4byte signatures", () => {
  // These are well-known, publicly documented selectors (balanceOf, approve,
  // mint, stake, withdraw) used here as a cross-check on the local keccak-based
  // selector table, independent of this project's own derivation.
  assert.strictEqual(L.SELECTORS["balanceOf(address)"], "0x70a08231");
  assert.strictEqual(L.SELECTORS["approve(address,uint256)"], "0x095ea7b3");
  assert.strictEqual(L.SELECTORS["transfer(address,uint256)"], "0xa9059cbb");
  assert.strictEqual(L.SELECTORS["mint(uint256)"], "0xa0712d68");
  assert.strictEqual(L.SELECTORS["stake(uint256)"], "0xa694fc3a");
  assert.strictEqual(L.SELECTORS["withdraw(uint256)"], "0x2e1a7d4d");
});
test("encodeCall: builds calldata with selector + packed args", () => {
  const addr = "0x" + "9".repeat(40);
  const data = L.encodeCall("balanceOf(address)", [L.encodeAddressArg(addr)]);
  assert.strictEqual(data.slice(0, 10), "0x70a08231");
  assert.strictEqual(data.length, 10 + 64);
});
test("encodeCall: unknown signature throws instead of sending bad calldata", () => {
  assert.throws(() => L.encodeCall("nonexistent()", []));
});

// --- chain identity ---
test("Sepolia chain id constants are consistent", () => {
  assert.strictEqual(L.SEPOLIA_CHAIN_ID, 11155111);
  assert.strictEqual(parseInt(L.SEPOLIA_CHAIN_ID_HEX, 16), 11155111);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
