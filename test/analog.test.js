"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const server = require("../server");

test("sanitizeAnalogChannel: clamps address to 0–7", () => {
  const ch = server._sanitizeAnalogChannel({ address: 10, mode: 3, loReal: 0, hiReal: 100, value: 50, name: "CH1", unit: "bar", id: "x" });
  assert.strictEqual(ch.address, 7);
});

test("sanitizeAnalogChannel: clamps mode to 0–4", () => {
  const ch = server._sanitizeAnalogChannel({ address: 0, mode: 9, loReal: 0, hiReal: 100, value: 50, name: "CH1", unit: "bar", id: "x" });
  assert.strictEqual(ch.mode, 4);
});

test("sanitizeAnalogChannel: defaults missing fields", () => {
  const ch = server._sanitizeAnalogChannel({});
  assert.strictEqual(typeof ch.id, "string");
  assert.strictEqual(ch.name, "Analog CH");
  assert.strictEqual(ch.address, 0);
  assert.strictEqual(ch.mode, 3);
  assert.strictEqual(ch.loReal, 0);
  assert.strictEqual(ch.hiReal, 100);
  assert.strictEqual(ch.value, 0);
  assert.strictEqual(ch.unit, "");
});

test("sanitizeAnalogChannel: truncates name to 80 chars", () => {
  const ch = server._sanitizeAnalogChannel({ name: "A".repeat(100) });
  assert.strictEqual(ch.name.length, 80);
});

test("sanitizeAnalogChannel: accepts negative loReal/hiReal", () => {
  const ch = server._sanitizeAnalogChannel({ loReal: -50, hiReal: -10, value: -30 });
  assert.strictEqual(ch.loReal, -50);
  assert.strictEqual(ch.hiReal, -10);
  assert.strictEqual(ch.value, -30);
});
