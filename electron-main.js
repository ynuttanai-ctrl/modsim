"use strict";

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { startApp, stopApp } = require("./server");

let mainWindow = null;
let serverInfo = null;
let stopping = false;

const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(createMainWindow).catch(showStartupError);
}

async function createMainWindow() {
  serverInfo = await startApp();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Modbus TCP Simulator",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  Menu.setApplicationMenu(createMenu());

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(serverInfo.url);
}

function createMenu() {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "Open UI In Browser",
          click: () => {
            if (serverInfo?.url) shell.openExternal(serverInfo.url);
          }
        },
        { type: "separator" },
        {
          label: "Exit",
          role: "quit"
        }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    }
  ]);
}

function showStartupError(error) {
  dialog.showErrorBox("Modbus TCP Simulator", error.message);
  app.quit();
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  await stopApp();
  app.quit();
});
