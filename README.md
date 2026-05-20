# Modbus TCP Simulator

Self-contained Modbus TCP simulator for testing Modbus masters such as Node-RED.

## Run

Desktop app:

```powershell
npm install
npm run electron
```

Headless simulator:

```powershell
npm start
```

Open:

```text
http://127.0.0.1:3000
```

If port `3000` is already in use, the app automatically tries the next port and prints the active URL.

Default Modbus endpoint:

```text
0.0.0.0:1502
```

Use port `502` only when your OS allows the process to bind privileged ports. For local testing, point Node-RED at `127.0.0.1:1502`.

## Model

- Gateway = one Modbus TCP listener, like one Ethernet-to-RS485 gateway.
- Slave device = one RS485 device behind that gateway, selected by Modbus Unit ID.
- Sensor = scaled 16-bit value exposed through holding or input registers.
- Raw point = holding/input register, coil, or discrete input.

The simulator supports function codes `1`, `2`, `3`, `4`, `5`, `6`, `15`, and `16`.

## Node-RED Flow

Install the Modbus nodes in Node-RED first:

```powershell
npm install node-red-contrib-modbus
```

Then import:

```text
nodered/modbus-simulator-flow.json
```

The flow reads:

```text
Unit ID 1, FC3 holding registers, address 0, quantity 3
Unit ID 2, FC4 input registers, address 0, quantity 1
```

The function nodes divide raw register values by `100` to convert back to amps.

## Multiple IP Addresses

Add one gateway per IP address in the UI. The IP must exist on the machine running this app. If you only need local Node-RED testing, use different ports on `127.0.0.1` or `0.0.0.0`.

Examples:

```text
127.0.0.1:1502
127.0.0.1:1503
127.0.0.1:1504
```

For real LAN IP simulation, add IP aliases to the network adapter first, then bind each gateway to one of those addresses.
