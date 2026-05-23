"use strict";

const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(ROOT, "config.json");
const DEFAULT_HTTP_HOST = process.env.HTTP_HOST || "127.0.0.1";
const DEFAULT_HTTP_PORT = Number.parseInt(process.env.HTTP_PORT || "3000", 10);

const TABLES = new Set(["holding", "input", "coils", "discrete"]);
const REGISTER_TABLES = new Set(["holding", "input"]);
const BOOL_TABLES = new Set(["coils", "discrete"]);

let config = loadConfig();
let saveTimer = null;
let httpServer = null;

const runtime = {
  endpoints: new Map(),
  logs: []
};

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultConfig() {
  return {
    endpoints: [
      {
        id: uid("endpoint"),
        name: "Gateway A",
        host: "0.0.0.0",
        port: 1502,
        enabled: true,
        devices: [
          {
            id: uid("device"),
            name: "Current Meter 1",
            unitId: 1,
            enabled: true,
            sensors: [
              {
                id: uid("sensor"),
                name: "Current L1",
                table: "holding",
                address: 0,
                scale: 100,
                value: 12.34,
                unit: "A"
              },
              {
                id: uid("sensor"),
                name: "Current L2",
                table: "holding",
                address: 1,
                scale: 100,
                value: 11.98,
                unit: "A"
              },
              {
                id: uid("sensor"),
                name: "Current L3",
                table: "holding",
                address: 2,
                scale: 100,
                value: 12.12,
                unit: "A"
              }
            ],
            points: [
              {
                id: uid("point"),
                name: "Run Command",
                table: "coils",
                address: 0,
                value: false
              },
              {
                id: uid("point"),
                name: "Healthy",
                table: "discrete",
                address: 0,
                value: true
              }
            ]
          },
          {
            id: uid("device"),
            name: "Current Meter 2",
            unitId: 2,
            enabled: true,
            sensors: [
              {
                id: uid("sensor"),
                name: "Current",
                table: "input",
                address: 0,
                scale: 100,
                value: 7.5,
                unit: "A"
              }
            ],
            points: []
          }
        ]
      }
    ]
  };
}

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const fresh = sanitizeConfig(defaultConfig());
      fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(fresh, null, 2)}\n`);
      return fresh;
    }

    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return sanitizeConfig(parsed);
  } catch (error) {
    console.error(`Failed to load config, using defaults: ${error.message}`);
    return sanitizeConfig(defaultConfig());
  }
}

function sanitizeConfig(raw) {
  const endpoints = Array.isArray(raw?.endpoints) ? raw.endpoints : [];
  return {
    endpoints: endpoints.map(sanitizeEndpoint)
  };
}

function sanitizeEndpoint(endpoint) {
  const devices = Array.isArray(endpoint?.devices) ? endpoint.devices : [];
  return {
    id: cleanText(endpoint?.id, uid("endpoint"), 80),
    name: cleanText(endpoint?.name, "Gateway", 80),
    host: cleanText(endpoint?.host, "0.0.0.0", 80),
    port: clampInt(endpoint?.port, 1502, 1, 65535),
    enabled: Boolean(endpoint?.enabled),
    devices: devices.map(sanitizeDevice)
  };
}

function sanitizeDevice(device) {
  const sensors = Array.isArray(device?.sensors) ? device.sensors : [];
  const points = Array.isArray(device?.points) ? device.points : [];
  const analogChannels = Array.isArray(device?.analogChannels) ? device.analogChannels : [];
  return {
    id: cleanText(device?.id, uid("device"), 80),
    name: cleanText(device?.name, "Slave Device", 80),
    unitId: clampInt(device?.unitId, 1, 0, 255),
    enabled: Boolean(device?.enabled),
    sensors: sensors.map(sanitizeSensor),
    points: points.map(sanitizePoint),
    analogChannels: analogChannels.map(sanitizeAnalogChannel)
  };
}

function sanitizeSensor(sensor) {
  const table = REGISTER_TABLES.has(sensor?.table) ? sensor.table : "holding";
  return {
    id: cleanText(sensor?.id, uid("sensor"), 80),
    name: cleanText(sensor?.name, "Sensor", 80),
    table,
    address: clampInt(sensor?.address, 0, 0, 65535),
    scale: finiteNumber(sensor?.scale, 1),
    value: finiteNumber(sensor?.value, 0),
    unit: cleanText(sensor?.unit, "", 20)
  };
}

function sanitizePoint(point) {
  const table = TABLES.has(point?.table) ? point.table : "holding";
  const value = BOOL_TABLES.has(table)
    ? Boolean(point?.value)
    : clampInt(point?.value, 0, 0, 65535);
  return {
    id: cleanText(point?.id, uid("point"), 80),
    name: cleanText(point?.name, "Point", 80),
    table,
    address: clampInt(point?.address, 0, 0, 65535),
    value
  };
}

function sanitizeAnalogChannel(ch) {
  return {
    id: cleanText(ch?.id, uid("analog"), 80),
    name: cleanText(ch?.name, "Analog CH", 80),
    address: clampInt(ch?.address, 0, 0, 7),
    mode: clampInt(ch?.mode, 3, 0, 4),
    loReal: finiteNumber(ch?.loReal, 0),
    hiReal: finiteNumber(ch?.hiReal, 100),
    unit: cleanText(ch?.unit, "", 20),
    value: finiteNumber(ch?.value, 0)
  };
}

function computeAnalogRegister(channel) {
  const { mode, loReal, hiReal, value } = channel;
  const span = hiReal - loReal;
  const ratio = span === 0 ? 0 : (value - loReal) / span;

  switch (mode) {
    case 3: return Math.min(20000, Math.max(4000, Math.round(4000 + ratio * 16000)));
    case 2: return Math.min(20000, Math.max(0, Math.round(ratio * 20000)));
    case 0: return Math.min(5000, Math.max(0, Math.round(ratio * 5000)));
    case 1: return Math.min(5000, Math.max(1000, Math.round(1000 + ratio * 4000)));
    case 4: return Math.min(4096, Math.max(0, Math.round(ratio * 4096)));
    default: return 0;
  }
}

function cleanText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function saveConfigSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, (error) => {
      if (error) log("error", `Failed to save config: ${error.message}`);
    });
  }, 250);
}

function saveConfigNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function log(level, message, endpointId = null) {
  runtime.logs.unshift({
    ts: new Date().toISOString(),
    level,
    message,
    endpointId
  });

  runtime.logs = runtime.logs.slice(0, 200);

  const writer = level === "error" ? console.error : console.log;
  writer(`[${level}] ${message}`);
}

function endpointKey(endpoint) {
  return endpoint.enabled ? `${endpoint.host}:${endpoint.port}` : "disabled";
}

function reconcileServers() {
  const wantedIds = new Set(config.endpoints.map((endpoint) => endpoint.id));

  for (const [endpointId, state] of runtime.endpoints.entries()) {
    const endpoint = config.endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint || !endpoint.enabled || state.key !== endpointKey(endpoint)) {
      stopEndpoint(endpointId);
    }
  }

  for (const endpoint of config.endpoints) {
    if (!wantedIds.has(endpoint.id) || !endpoint.enabled) continue;
    const state = runtime.endpoints.get(endpoint.id);
    if (!state || state.key !== endpointKey(endpoint)) {
      startEndpoint(endpoint);
    }
  }
}

function startEndpoint(endpoint) {
  const state = {
    key: endpointKey(endpoint),
    server: null,
    listening: false,
    error: null,
    connections: 0,
    requests: 0,
    lastRequest: null
  };

  const server = net.createServer((socket) => handleModbusConnection(endpoint.id, socket));
  state.server = server;
  runtime.endpoints.set(endpoint.id, state);

  server.on("error", (error) => {
    state.listening = false;
    state.error = error.message;
    log("error", `${endpoint.name} failed on ${endpoint.host}:${endpoint.port}: ${error.message}`, endpoint.id);
  });

  server.on("listening", () => {
    state.listening = true;
    state.error = null;
    log("info", `${endpoint.name} listening on ${endpoint.host}:${endpoint.port}`, endpoint.id);
  });

  server.on("close", () => {
    state.listening = false;
  });

  server.listen(endpoint.port, endpoint.host);
}

function stopEndpoint(endpointId) {
  const state = runtime.endpoints.get(endpointId);
  if (!state) return;

  runtime.endpoints.delete(endpointId);
  try {
    state.server.close();
  } catch (error) {
    log("error", `Failed to close endpoint ${endpointId}: ${error.message}`, endpointId);
  }
}

function handleModbusConnection(endpointId, socket) {
  const state = runtime.endpoints.get(endpointId);
  if (state) state.connections += 1;

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 7) {
      const length = buffer.readUInt16BE(4);
      const frameLength = 6 + length;
      if (length < 2) {
        buffer = buffer.slice(7);
        continue;
      }
      if (buffer.length < frameLength) break;

      const frame = buffer.slice(0, frameLength);
      buffer = buffer.slice(frameLength);

      const response = handleModbusFrame(endpointId, frame);
      if (response) socket.write(response);
    }
  });

  socket.on("close", () => {
    const current = runtime.endpoints.get(endpointId);
    if (current) current.connections = Math.max(0, current.connections - 1);
  });
}

function handleModbusFrame(endpointId, frame) {
  const transactionId = frame.readUInt16BE(0);
  const protocolId = frame.readUInt16BE(2);
  const unitId = frame.readUInt8(6);
  const pdu = frame.slice(7);

  const state = runtime.endpoints.get(endpointId);
  if (state) {
    state.requests += 1;
    state.lastRequest = new Date().toISOString();
  }

  if (protocolId !== 0 || pdu.length < 1) {
    return null;
  }

  const functionCode = pdu.readUInt8(0);
  const endpoint = config.endpoints.find((entry) => entry.id === endpointId);
  const device = endpoint?.devices.find((entry) => entry.enabled && entry.unitId === unitId);

  if (!device) {
    return buildException(transactionId, unitId, functionCode, 0x0b);
  }

  try {
    switch (functionCode) {
      case 1:
        return handleReadBits(transactionId, unitId, functionCode, device, pdu, "coils");
      case 2:
        return handleReadBits(transactionId, unitId, functionCode, device, pdu, "discrete");
      case 3:
        return handleReadRegisters(transactionId, unitId, functionCode, device, pdu, "holding");
      case 4:
        return handleReadRegisters(transactionId, unitId, functionCode, device, pdu, "input");
      case 5:
        return handleWriteSingleCoil(transactionId, unitId, functionCode, device, pdu);
      case 6:
        return handleWriteSingleRegister(transactionId, unitId, functionCode, device, pdu);
      case 15:
        return handleWriteMultipleCoils(transactionId, unitId, functionCode, device, pdu);
      case 16:
        return handleWriteMultipleRegisters(transactionId, unitId, functionCode, device, pdu);
      default:
        return buildException(transactionId, unitId, functionCode, 0x01);
    }
  } catch (error) {
    log("error", `Modbus frame failed: ${error.message}`, endpointId);
    return buildException(transactionId, unitId, functionCode, 0x04);
  }
}

function handleReadRegisters(transactionId, unitId, functionCode, device, pdu, table) {
  if (pdu.length < 5) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const quantity = pdu.readUInt16BE(3);
  if (quantity < 1 || quantity > 125 || address + quantity > 65536) {
    return buildException(transactionId, unitId, functionCode, 0x03);
  }

  const responsePdu = Buffer.alloc(2 + quantity * 2);
  responsePdu.writeUInt8(functionCode, 0);
  responsePdu.writeUInt8(quantity * 2, 1);

  for (let index = 0; index < quantity; index += 1) {
    responsePdu.writeUInt16BE(readRegister(device, table, address + index), 2 + index * 2);
  }

  return buildResponse(transactionId, unitId, responsePdu);
}

function handleReadBits(transactionId, unitId, functionCode, device, pdu, table) {
  if (pdu.length < 5) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const quantity = pdu.readUInt16BE(3);
  if (quantity < 1 || quantity > 2000 || address + quantity > 65536) {
    return buildException(transactionId, unitId, functionCode, 0x03);
  }

  const byteCount = Math.ceil(quantity / 8);
  const responsePdu = Buffer.alloc(2 + byteCount);
  responsePdu.writeUInt8(functionCode, 0);
  responsePdu.writeUInt8(byteCount, 1);

  for (let index = 0; index < quantity; index += 1) {
    if (readBit(device, table, address + index)) {
      responsePdu[2 + Math.floor(index / 8)] |= 1 << (index % 8);
    }
  }

  return buildResponse(transactionId, unitId, responsePdu);
}

function handleWriteSingleRegister(transactionId, unitId, functionCode, device, pdu) {
  if (pdu.length < 5) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const value = pdu.readUInt16BE(3);
  const exception = writeRegister(device, address, value);
  if (exception) return buildException(transactionId, unitId, functionCode, exception);
  saveConfigSoon();
  return buildResponse(transactionId, unitId, pdu.slice(0, 5));
}

function handleWriteMultipleRegisters(transactionId, unitId, functionCode, device, pdu) {
  if (pdu.length < 6) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const quantity = pdu.readUInt16BE(3);
  const byteCount = pdu.readUInt8(5);
  if (quantity < 1 || quantity > 123 || byteCount !== quantity * 2 || pdu.length < 6 + byteCount || address + quantity > 65536) {
    return buildException(transactionId, unitId, functionCode, 0x03);
  }

  for (let index = 0; index < quantity; index += 1) {
    const exception = writeRegister(device, address + index, pdu.readUInt16BE(6 + index * 2));
    if (exception) return buildException(transactionId, unitId, functionCode, exception);
  }

  saveConfigSoon();

  const responsePdu = Buffer.alloc(5);
  responsePdu.writeUInt8(functionCode, 0);
  responsePdu.writeUInt16BE(address, 1);
  responsePdu.writeUInt16BE(quantity, 3);
  return buildResponse(transactionId, unitId, responsePdu);
}

function handleWriteSingleCoil(transactionId, unitId, functionCode, device, pdu) {
  if (pdu.length < 5) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const encoded = pdu.readUInt16BE(3);
  if (encoded !== 0xff00 && encoded !== 0x0000) {
    return buildException(transactionId, unitId, functionCode, 0x03);
  }

  writeBit(device, address, encoded === 0xff00);
  saveConfigSoon();
  return buildResponse(transactionId, unitId, pdu.slice(0, 5));
}

function handleWriteMultipleCoils(transactionId, unitId, functionCode, device, pdu) {
  if (pdu.length < 6) return buildException(transactionId, unitId, functionCode, 0x03);

  const address = pdu.readUInt16BE(1);
  const quantity = pdu.readUInt16BE(3);
  const byteCount = pdu.readUInt8(5);
  if (quantity < 1 || quantity > 1968 || byteCount !== Math.ceil(quantity / 8) || pdu.length < 6 + byteCount || address + quantity > 65536) {
    return buildException(transactionId, unitId, functionCode, 0x03);
  }

  for (let index = 0; index < quantity; index += 1) {
    const byte = pdu[6 + Math.floor(index / 8)];
    writeBit(device, address + index, Boolean(byte & (1 << (index % 8))));
  }

  saveConfigSoon();

  const responsePdu = Buffer.alloc(5);
  responsePdu.writeUInt8(functionCode, 0);
  responsePdu.writeUInt16BE(address, 1);
  responsePdu.writeUInt16BE(quantity, 3);
  return buildResponse(transactionId, unitId, responsePdu);
}

function readRegister(device, table, address) {
  const sensor = device.sensors.find((entry) => entry.table === table && entry.address === address);
  if (sensor) return toUInt16(Math.round(sensor.value * sensor.scale));

  if (table === "input") {
    const channel = device.analogChannels?.find((ch) => ch.address === address);
    if (channel) return computeAnalogRegister(channel);
  }

  if (table === "holding" && address >= 0x1000 && address <= 0x1007) {
    const channelAddress = address - 0x1000;
    const channel = device.analogChannels?.find((ch) => ch.address === channelAddress);
    return channel ? channel.mode : 0;
  }

  const point = device.points.find((entry) => entry.table === table && entry.address === address);
  if (point) return toUInt16(point.value);

  return 0;
}

function writeRegister(device, address, rawValue) {
  if (address >= 0x1000 && address <= 0x1007) {
    const channelAddress = address - 0x1000;
    const channel = device.analogChannels?.find((ch) => ch.address === channelAddress);
    if (channel) {
      if (rawValue < 0 || rawValue > 4) return 0x03;
      channel.mode = rawValue;
    }
    return;
  }

  const sensor = device.sensors.find((entry) => entry.table === "holding" && entry.address === address);
  if (sensor) {
    const scale = sensor.scale || 1;
    sensor.value = rawValue / scale;
    return;
  }

  let point = device.points.find((entry) => entry.table === "holding" && entry.address === address);
  if (!point) {
    point = {
      id: uid("point"),
      name: `Holding ${address}`,
      table: "holding",
      address,
      value: 0
    };
    device.points.push(point);
  }

  point.value = toUInt16(rawValue);
}

function readBit(device, table, address) {
  const point = device.points.find((entry) => entry.table === table && entry.address === address);
  return Boolean(point?.value);
}

function writeBit(device, address, value) {
  let point = device.points.find((entry) => entry.table === "coils" && entry.address === address);
  if (!point) {
    point = {
      id: uid("point"),
      name: `Coil ${address}`,
      table: "coils",
      address,
      value: false
    };
    device.points.push(point);
  }

  point.value = Boolean(value);
}

function toUInt16(value) {
  const number = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return ((number % 65536) + 65536) % 65536;
}

function buildException(transactionId, unitId, functionCode, code) {
  return buildResponse(transactionId, unitId, Buffer.from([functionCode | 0x80, code]));
}

function buildResponse(transactionId, unitId, pdu) {
  const response = Buffer.alloc(7 + pdu.length);
  response.writeUInt16BE(transactionId, 0);
  response.writeUInt16BE(0, 2);
  response.writeUInt16BE(1 + pdu.length, 4);
  response.writeUInt8(unitId, 6);
  pdu.copy(response, 7);
  return response;
}

function endpointStatus() {
  return config.endpoints.map((endpoint) => {
    const state = runtime.endpoints.get(endpoint.id);
    return {
      id: endpoint.id,
      name: endpoint.name,
      host: endpoint.host,
      port: endpoint.port,
      enabled: endpoint.enabled,
      listening: Boolean(state?.listening),
      error: state?.error || null,
      connections: state?.connections || 0,
      requests: state?.requests || 0,
      lastRequest: state?.lastRequest || null
    };
  });
}

function createHttpServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (url.pathname === "/api/config" && request.method === "GET") {
        return sendJson(response, 200, config);
      }

      if (url.pathname === "/api/status" && request.method === "GET") {
        return sendJson(response, 200, {
          endpoints: endpointStatus(),
          logs: runtime.logs
        });
      }

      if (url.pathname === "/api/config" && request.method === "PUT") {
        const body = await readBody(request);
        config = sanitizeConfig(JSON.parse(body || "{}"));
        saveConfigNow();
        reconcileServers();
        return sendJson(response, 200, {
          ok: true,
          config,
          status: endpointStatus()
        });
      }

      if (url.pathname === "/api/default-config" && request.method === "POST") {
        config = sanitizeConfig(defaultConfig());
        saveConfigNow();
        reconcileServers();
        return sendJson(response, 200, {
          ok: true,
          config,
          status: endpointStatus()
        });
      }

      return serveStatic(url.pathname, response);
    } catch (error) {
      return sendJson(response, 500, {
        ok: false,
        error: error.message
      });
    }
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function stopApp({ exit = false } = {}) {
  try {
    saveConfigNow();
  } catch (error) {
    console.error(error.message);
  }

  for (const endpointId of Array.from(runtime.endpoints.keys())) {
    stopEndpoint(endpointId);
  }

  if (httpServer) {
    await new Promise((resolve) => {
      try {
        httpServer.close(() => resolve());
      } catch (error) {
        console.error(error.message);
        resolve();
      }
    });
    httpServer = null;
  }

  if (exit) {
    process.exit(0);
  }
}

function shutdown() {
  stopApp({ exit: true });
}

function startApp(options = {}) {
  reconcileServers();
  return startHttpServer({
    port: options.httpPort ?? DEFAULT_HTTP_PORT,
    host: options.httpHost ?? DEFAULT_HTTP_HOST,
    attemptsLeft: options.httpPortAttempts ?? 20
  });
}

function startHttpServer({ port, host, attemptsLeft }) {
  return new Promise((resolve, reject) => {
    httpServer = createHttpServer();

    httpServer.once("error", (error) => {
      if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
        log("info", `UI port ${port} is in use, trying ${port + 1}`);
        startHttpServer({ port: port + 1, host, attemptsLeft: attemptsLeft - 1 })
          .then(resolve)
          .catch(reject);
        return;
      }

      log("error", `UI failed on ${host}:${port}: ${error.message}`);
      reject(error);
    });

    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${actualPort}`;
      log("info", `UI listening on ${url}`);
      resolve({ host, port: actualPort, url });
    });
  });
}

if (require.main === module) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  startApp().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  startApp,
  stopApp,
  _sanitizeAnalogChannel: sanitizeAnalogChannel,
  _computeAnalogRegister: computeAnalogRegister,
  _readRegister: readRegister,
  _writeRegister: writeRegister
};
