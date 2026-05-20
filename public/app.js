"use strict";

const state = {
  config: { endpoints: [] },
  status: { endpoints: [], logs: [] },
  selectedEndpointId: null,
  selectedDeviceId: null,
  tab: "sensors",
  dirty: false
};

const $ = (selector) => document.querySelector(selector);

const endpointList = $("#endpoint-list");
const gatewayPanel = $("#gateway-panel");
const devicePanel = $("#device-panel");
const logPanel = $("#log-panel");
const summary = $("#summary");

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedEndpoint() {
  return state.config.endpoints.find((endpoint) => endpoint.id === state.selectedEndpointId) || state.config.endpoints[0] || null;
}

function selectedDevice() {
  const endpoint = selectedEndpoint();
  if (!endpoint) return null;
  return endpoint.devices.find((device) => device.id === state.selectedDeviceId) || endpoint.devices[0] || null;
}

function endpointStatus(endpointId) {
  return state.status.endpoints.find((entry) => entry.id === endpointId) || null;
}

function markDirty() {
  state.dirty = true;
  $("#save").textContent = "Apply *";
}

async function load() {
  const [configResponse, statusResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/status")
  ]);
  state.config = await configResponse.json();
  state.status = await statusResponse.json();
  state.selectedEndpointId ||= state.config.endpoints[0]?.id || null;
  state.selectedDeviceId ||= selectedEndpoint()?.devices[0]?.id || null;
  render();
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    state.status = await response.json();
    renderSummary();
    renderEndpointList();
    renderLogs();
  } catch (error) {
    summary.textContent = error.message;
  }
}

async function save() {
  const response = await fetch("/api/config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(state.config)
  });

  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Save failed");
  }

  state.config = payload.config;
  state.status = { endpoints: payload.status || [], logs: state.status.logs || [] };
  state.dirty = false;
  $("#save").textContent = "Apply";
  render();
}

function render() {
  const endpoint = selectedEndpoint();
  if (endpoint && endpoint.id !== state.selectedEndpointId) state.selectedEndpointId = endpoint.id;

  const device = selectedDevice();
  if (device && device.id !== state.selectedDeviceId) state.selectedDeviceId = device.id;

  renderSummary();
  renderEndpointList();
  renderGateway();
  renderDevice();
  renderLogs();
}

function renderSummary() {
  const statuses = state.status.endpoints || [];
  const online = statuses.filter((entry) => entry.enabled && entry.listening).length;
  const total = state.config.endpoints.length;
  const requests = statuses.reduce((sum, entry) => sum + Number(entry.requests || 0), 0);
  summary.textContent = `${online}/${total} gateways listening, ${requests} Modbus requests`;
}

function renderEndpointList() {
  endpointList.innerHTML = state.config.endpoints.map((endpoint) => {
    const status = endpointStatus(endpoint.id);
    const dotClass = !endpoint.enabled ? "off" : status?.error ? "error" : status?.listening ? "ok" : "";
    const label = !endpoint.enabled ? "Disabled" : status?.error ? "Error" : status?.listening ? "Listening" : "Starting";
    const active = endpoint.id === state.selectedEndpointId ? " active" : "";
    return `
      <button class="endpoint-item${active}" type="button" data-action="select-endpoint" data-id="${escapeHtml(endpoint.id)}">
        <span class="endpoint-name">${escapeHtml(endpoint.name)}</span>
        <span class="endpoint-meta">${escapeHtml(endpoint.host)}:${endpoint.port} / ${endpoint.devices.length} slaves</span>
        <span class="status-line"><span class="dot ${dotClass}"></span>${label}</span>
      </button>
    `;
  }).join("");
}

function renderGateway() {
  const endpoint = selectedEndpoint();
  if (!endpoint) {
    gatewayPanel.innerHTML = $("#empty-template").innerHTML;
    return;
  }

  const status = endpointStatus(endpoint.id);
  gatewayPanel.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(endpoint.name)}</h2>
          <p>${escapeHtml(endpoint.host)}:${endpoint.port}</p>
        </div>
        <div class="row-actions">
          <button type="button" data-action="add-device">+ Slave</button>
          <button type="button" class="danger" data-action="remove-endpoint">Delete</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="grid">
          <label class="field">
            Name
            <input data-field="endpoint.name" value="${escapeHtml(endpoint.name)}">
          </label>
          <label class="field">
            Bind IP
            <input data-field="endpoint.host" value="${escapeHtml(endpoint.host)}">
          </label>
          <label class="field">
            Port
            <input type="number" min="1" max="65535" data-field="endpoint.port" value="${endpoint.port}">
          </label>
          <label class="check-field">
            <input type="checkbox" data-field="endpoint.enabled" ${endpoint.enabled ? "checked" : ""}>
            Enabled
          </label>
        </div>
        ${status?.error ? `<p class="error-text">${escapeHtml(status.error)}</p>` : ""}
      </div>
    </section>
  `;
}

function renderDevice() {
  const endpoint = selectedEndpoint();
  const device = selectedDevice();
  if (!endpoint) {
    devicePanel.innerHTML = "";
    return;
  }

  const deviceList = endpoint.devices.map((entry) => `
    <button class="device-item ${entry.id === state.selectedDeviceId ? "active" : ""}" type="button" data-action="select-device" data-id="${escapeHtml(entry.id)}">
      <strong>${escapeHtml(entry.name)}</strong>
      <span class="muted">Unit ID ${entry.unitId} ${entry.enabled ? "" : "/ disabled"}</span>
    </button>
  `).join("");

  const details = device ? renderDeviceDetails(device) : `<div class="empty"><h2>No slave device</h2></div>`;

  devicePanel.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>RS485 Daisy Chain</h2>
          <p>${endpoint.devices.length} Unit IDs on ${escapeHtml(endpoint.name)}</p>
        </div>
      </div>
      <div class="panel-body split">
        <div class="device-list">
          ${deviceList}
        </div>
        <div>${details}</div>
      </div>
    </section>
  `;
}

function renderDeviceDetails(device) {
  return `
    <div class="grid">
      <label class="field">
        Device Name
        <input data-field="device.name" value="${escapeHtml(device.name)}">
      </label>
      <label class="field small">
        Unit ID
        <input type="number" min="0" max="255" data-field="device.unitId" value="${device.unitId}">
      </label>
      <label class="check-field">
        <input type="checkbox" data-field="device.enabled" ${device.enabled ? "checked" : ""}>
        Enabled
      </label>
      <div class="row-actions">
        <button type="button" class="danger" data-action="remove-device">Delete</button>
      </div>
    </div>

    <div class="tabs">
      <button type="button" class="tab ${state.tab === "sensors" ? "active" : ""}" data-action="tab" data-tab="sensors">Sensors</button>
      <button type="button" class="tab ${state.tab === "points" ? "active" : ""}" data-action="tab" data-tab="points">Raw Points</button>
    </div>

    ${state.tab === "points" ? renderPoints(device) : renderSensors(device)}
  `;
}

function renderSensors(device) {
  const rows = device.sensors.map((sensor) => `
    <tr data-sensor-id="${escapeHtml(sensor.id)}">
      <td><input data-field="sensor.name" value="${escapeHtml(sensor.name)}"></td>
      <td>${tableSelect("sensor.table", sensor.table, ["holding", "input"])}</td>
      <td><input type="number" min="0" max="65535" data-field="sensor.address" value="${sensor.address}"></td>
      <td><input type="number" step="0.001" data-field="sensor.value" value="${sensor.value}"></td>
      <td><input type="number" step="0.001" data-field="sensor.scale" value="${sensor.scale}"></td>
      <td><input data-field="sensor.unit" value="${escapeHtml(sensor.unit)}"></td>
      <td class="muted">${Math.round(Number(sensor.value || 0) * Number(sensor.scale || 1))}</td>
      <td><button class="icon danger" title="Delete" type="button" data-action="remove-sensor" data-id="${escapeHtml(sensor.id)}">x</button></td>
    </tr>
  `).join("");

  return `
    <div class="panel-header inline">
      <h3>Current Sensor Values</h3>
      <button type="button" data-action="add-sensor">+ Sensor</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Table</th>
            <th>Address</th>
            <th>Value</th>
            <th>Scale</th>
            <th>Unit</th>
            <th>Raw</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderPoints(device) {
  const rows = device.points.map((point) => `
    <tr data-point-id="${escapeHtml(point.id)}">
      <td><input data-field="point.name" value="${escapeHtml(point.name)}"></td>
      <td>${tableSelect("point.table", point.table, ["holding", "input", "coils", "discrete"])}</td>
      <td><input type="number" min="0" max="65535" data-field="point.address" value="${point.address}"></td>
      <td>${BOOL_TABLES.has(point.table) ? boolSelect("point.value", point.value) : `<input type="number" min="0" max="65535" data-field="point.value" value="${point.value}">`}</td>
      <td><button class="icon danger" title="Delete" type="button" data-action="remove-point" data-id="${escapeHtml(point.id)}">x</button></td>
    </tr>
  `).join("");

  return `
    <div class="panel-header inline">
      <h3>Raw Registers And Bits</h3>
      <button type="button" data-action="add-point">+ Point</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Table</th>
            <th>Address</th>
            <th>Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

const BOOL_TABLES = new Set(["coils", "discrete"]);

function tableSelect(field, value, options) {
  return `
    <select data-field="${field}">
      ${options.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option}</option>`).join("")}
    </select>
  `;
}

function boolSelect(field, value) {
  return `
    <select data-field="${field}">
      <option value="true" ${value ? "selected" : ""}>true</option>
      <option value="false" ${value ? "" : "selected"}>false</option>
    </select>
  `;
}

function renderLogs() {
  const entries = (state.status.logs || []).slice(0, 20).map((entry) => `
    <div class="log-entry">
      <span class="muted">${new Date(entry.ts).toLocaleString()}</span>
      <strong>${escapeHtml(entry.level)}</strong>
      <span>${escapeHtml(entry.message)}</span>
    </div>
  `).join("");

  logPanel.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>Runtime Log</h2>
      </div>
      <div class="panel-body log-list">${entries || `<span class="muted">No log entries</span>`}</div>
    </section>
  `;
}

function currentFieldTarget(element) {
  const device = selectedDevice();
  const endpoint = selectedEndpoint();
  const field = element.dataset.field;

  if (!field || !endpoint) return null;
  if (field.startsWith("endpoint.")) return { object: endpoint, property: field.split(".")[1] };
  if (field.startsWith("device.") && device) return { object: device, property: field.split(".")[1] };

  const sensorRow = element.closest("[data-sensor-id]");
  if (field.startsWith("sensor.") && sensorRow && device) {
    const sensor = device.sensors.find((entry) => entry.id === sensorRow.dataset.sensorId);
    return sensor ? { object: sensor, property: field.split(".")[1] } : null;
  }

  const pointRow = element.closest("[data-point-id]");
  if (field.startsWith("point.") && pointRow && device) {
    const point = device.points.find((entry) => entry.id === pointRow.dataset.pointId);
    return point ? { object: point, property: field.split(".")[1] } : null;
  }

  return null;
}

function setField(element) {
  const target = currentFieldTarget(element);
  if (!target) return;

  const { object, property } = target;
  if (element.type === "checkbox") {
    object[property] = element.checked;
  } else if (["port", "unitId", "address"].includes(property)) {
    object[property] = Number.parseInt(element.value, 10) || 0;
  } else if (["value", "scale"].includes(property) && element.tagName !== "SELECT") {
    object[property] = Number(element.value) || 0;
  } else if (property === "value" && element.tagName === "SELECT") {
    object[property] = element.value === "true";
  } else {
    object[property] = element.value;
  }

  markDirty();
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-field]")) setField(event.target);
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-field]")) {
    setField(event.target);
    render();
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const endpoint = selectedEndpoint();
  const device = selectedDevice();

  if (action === "select-endpoint") {
    state.selectedEndpointId = button.dataset.id;
    state.selectedDeviceId = selectedEndpoint()?.devices[0]?.id || null;
    render();
  }

  if (action === "select-device") {
    state.selectedDeviceId = button.dataset.id;
    render();
  }

  if (action === "tab") {
    state.tab = button.dataset.tab;
    render();
  }

  if (action === "add-device" && endpoint) {
    const used = new Set(endpoint.devices.map((entry) => entry.unitId));
    let unitId = 1;
    while (used.has(unitId) && unitId < 255) unitId += 1;
    const added = {
      id: uid("device"),
      name: `Slave ${unitId}`,
      unitId,
      enabled: true,
      sensors: [],
      points: []
    };
    endpoint.devices.push(added);
    state.selectedDeviceId = added.id;
    markDirty();
    render();
  }

  if (action === "remove-device" && endpoint && device) {
    endpoint.devices = endpoint.devices.filter((entry) => entry.id !== device.id);
    state.selectedDeviceId = endpoint.devices[0]?.id || null;
    markDirty();
    render();
  }

  if (action === "add-sensor" && device) {
    device.sensors.push({
      id: uid("sensor"),
      name: "Current",
      table: "holding",
      address: nextAddress(device.sensors, "holding"),
      scale: 100,
      value: 0,
      unit: "A"
    });
    state.tab = "sensors";
    markDirty();
    render();
  }

  if (action === "remove-sensor" && device) {
    device.sensors = device.sensors.filter((entry) => entry.id !== button.dataset.id);
    markDirty();
    render();
  }

  if (action === "add-point" && device) {
    device.points.push({
      id: uid("point"),
      name: "Holding",
      table: "holding",
      address: nextAddress(device.points, "holding"),
      value: 0
    });
    state.tab = "points";
    markDirty();
    render();
  }

  if (action === "remove-point" && device) {
    device.points = device.points.filter((entry) => entry.id !== button.dataset.id);
    markDirty();
    render();
  }

  if (action === "remove-endpoint" && endpoint) {
    state.config.endpoints = state.config.endpoints.filter((entry) => entry.id !== endpoint.id);
    state.selectedEndpointId = state.config.endpoints[0]?.id || null;
    state.selectedDeviceId = selectedEndpoint()?.devices[0]?.id || null;
    markDirty();
    render();
  }

  if (action === "select-endpoint" || action === "select-device" || action === "tab") return;
});

$("#add-endpoint").addEventListener("click", () => {
  const added = {
    id: uid("endpoint"),
    name: `Gateway ${state.config.endpoints.length + 1}`,
    host: "0.0.0.0",
    port: 1502 + state.config.endpoints.length,
    enabled: true,
    devices: []
  };
  state.config.endpoints.push(added);
  state.selectedEndpointId = added.id;
  state.selectedDeviceId = null;
  markDirty();
  render();
});

$("#save").addEventListener("click", async () => {
  const button = $("#save");
  button.disabled = true;
  button.textContent = "Applying";
  try {
    await save();
  } catch (error) {
    summary.textContent = error.message;
    button.textContent = "Apply *";
  } finally {
    button.disabled = false;
  }
});

function nextAddress(entries, table) {
  const used = new Set(entries.filter((entry) => entry.table === table).map((entry) => Number(entry.address)));
  let address = 0;
  while (used.has(address) && address < 65535) address += 1;
  return address;
}

load().catch((error) => {
  summary.textContent = error.message;
});

setInterval(refreshStatus, 2000);
