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

test("computeAnalogRegister: mode 3 (4~20mA) midpoint → 12000 μA", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 0, hiReal: 100, value: 50 });
  assert.strictEqual(result, 12000);
});

test("computeAnalogRegister: mode 3 clamps below 4000 at lo", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 0, hiReal: 100, value: -10 });
  assert.strictEqual(result, 4000);
});

test("computeAnalogRegister: mode 3 clamps above 20000 at hi", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 0, hiReal: 100, value: 110 });
  assert.strictEqual(result, 20000);
});

test("computeAnalogRegister: mode 3 hi value → 20000 μA", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 0, hiReal: 100, value: 100 });
  assert.strictEqual(result, 20000);
});

test("computeAnalogRegister: mode 3 lo value → 4000 μA", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 0, hiReal: 100, value: 0 });
  assert.strictEqual(result, 4000);
});

test("computeAnalogRegister: mode 2 (0~20mA) midpoint → 10000 μA", () => {
  const result = server._computeAnalogRegister({ mode: 2, loReal: 0, hiReal: 100, value: 50 });
  assert.strictEqual(result, 10000);
});

test("computeAnalogRegister: mode 2 clamps to [0, 20000]", () => {
  assert.strictEqual(server._computeAnalogRegister({ mode: 2, loReal: 0, hiReal: 100, value: -5 }), 0);
  assert.strictEqual(server._computeAnalogRegister({ mode: 2, loReal: 0, hiReal: 100, value: 105 }), 20000);
});

test("computeAnalogRegister: mode 0 (0~5V) midpoint → 2500 mV", () => {
  const result = server._computeAnalogRegister({ mode: 0, loReal: 0, hiReal: 100, value: 50 });
  assert.strictEqual(result, 2500);
});

test("computeAnalogRegister: mode 1 (1~5V) midpoint → 3000 mV", () => {
  const result = server._computeAnalogRegister({ mode: 1, loReal: 0, hiReal: 100, value: 50 });
  assert.strictEqual(result, 3000);
});

test("computeAnalogRegister: mode 4 (raw ADC) midpoint → 2048", () => {
  const result = server._computeAnalogRegister({ mode: 4, loReal: 0, hiReal: 100, value: 50 });
  assert.strictEqual(result, 2048);
});

test("computeAnalogRegister: loReal === hiReal (division by zero) → lo clamp", () => {
  const result = server._computeAnalogRegister({ mode: 3, loReal: 50, hiReal: 50, value: 50 });
  assert.strictEqual(result, 4000);
});
