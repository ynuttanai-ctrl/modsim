# Analog 4-20mA Channel Simulation — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add analog channel simulation to the Modbus TCP Simulator, modelled after the **Waveshare Industrial Modbus RTU Analog Input 8CH** device. Each device can have up to 8 analog channels. Channels expose:

- An **input register** (FC04) containing the computed signal value in μA or mV
- A **holding register** (FC03/06/10) at `0x1000 + channelIndex` for reading and writing the channel mode — identical to the real Waveshare device

## Data Model

A new `analogChannels` array is added to each device object (alongside existing `sensors` and `points`):

```json
{
  "analogChannels": [
    {
      "id": "analog-...",
      "name": "Pressure CH1",
      "address": 0,
      "mode": 3,
      "loReal": 0.0,
      "hiReal": 100.0,
      "unit": "bar",
      "value": 50.0
    }
  ]
}
```

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | string | unique | Internal ID |
| `name` | string | max 80 chars | Display name |
| `address` | int | 0–7 | Channel index → input register `3x000N` |
| `mode` | int | 0–4 | Signal range mode (see table below) |
| `loReal` | float | finite | Engineering value at lo signal end |
| `hiReal` | float | finite | Engineering value at hi signal end |
| `unit` | string | max 20 chars | Engineering unit label |
| `value` | float | finite | Current engineering value |

**Mode values** (matching Waveshare Protocol V2):

| Mode | Range | Output | Unit |
|------|-------|--------|------|
| 0 | 0–5V | 0–5000 | mV |
| 1 | 1–5V | 1000–5000 | mV |
| 2 | 0–20mA | 0–20000 | μA |
| 3 | 4~20mA | 4000–20000 | μA |
| 4 | Raw ADC | 0–4096 | — |

## Register Behavior

### Input Register (FC04, address `0x000N`)

Register value is computed from `value`, `loReal`, `hiReal`, and `mode`:

| Mode | Formula | Clamp |
|------|---------|-------|
| 3 (4~20mA) | `4000 + (value−loReal)/(hiReal−loReal) × 16000` | [4000, 20000] |
| 2 (0~20mA) | `(value−loReal)/(hiReal−loReal) × 20000` | [0, 20000] |
| 0 (0~5V) | `(value−loReal)/(hiReal−loReal) × 5000` | [0, 5000] |
| 1 (1~5V) | `1000 + (value−loReal)/(hiReal−loReal) × 4000` | [1000, 5000] |
| 4 (raw ADC) | `(value−loReal)/(hiReal−loReal) × 4096` | [0, 4096] |

Result is `Math.round()` then clamped to the output range. Division by zero (loReal === hiReal) returns the low end of the clamp range.

### Holding Register (FC03/06/10, address `0x1000 + channel.address`)

- **Read (FC03):** returns `channel.mode` (0–4)
- **Write (FC06/FC10):** sets `channel.mode`; values outside 0–4 return Modbus exception 0x03

### Register Lookup Priority

For input registers (`table === "input"`):
```
sensor at address → analogChannel at address (computed) → point at address → 0
```

For holding registers (`table === "holding"`):
```
if address in [0x1000, 0x1007]:
  → analog config register (mode R/W)
else:
  → sensor at address → point at address → 0
```

## Server Changes (`server.js`)

1. **`sanitizeAnalogChannel(ch)`** — new function; validates and clamps all fields
2. **`sanitizeDevice()`** — add `analogChannels` mapping via `sanitizeAnalogChannel`
3. **`readRegister(device, table, address)`** — add analog channel lookup in input path; add mode register read in holding path for 0x1000–0x1007
4. **`writeRegister(device, address, rawValue)`** — intercept 0x1000–0x1007 writes to update `channel.mode`; reject invalid mode values with exception 0x03

## UI Changes (`public/app.js`)

1. **Tab "Analog"** — added alongside "Sensors" and "Raw Points" in device detail
2. **`renderAnalogChannels(device)`** — new function; renders table with columns:
   - Name, Address (0–7), Mode (dropdown), Lo Value, Hi Value, Value, Unit, Computed (read-only), Delete
3. **`currentFieldTarget()`** — handle `data-field="analog.*"` with `data-analog-id` row attribute
4. **Click handler** — handle `add-analog` (default: mode=3, next available address) and `remove-analog` actions
5. **`+ Analog Channel` button** — in the tab header, creates a new channel with mode=3 (4~20mA)

The Computed column updates live as the user types `value`/`loReal`/`hiReal` (same pattern as existing "Raw" column in Sensors table).

UI reflects Modbus master writes to mode registers automatically via the existing 2-second status poll.

## Out of Scope

- Voltage mode hardware jumper simulation (Waveshare requires physical jumper change for current/voltage switching — noted in UI only as a label)
- Multi-register (32-bit float) output formats
- Per-channel alarm registers
