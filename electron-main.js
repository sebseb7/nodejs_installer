const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Import the NodeJS installer class
const NodeJSInstaller = require('./index');

// Keep a global reference of the window object
let mainWindow;

// Create the browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    resizable: true,
    title: 'Debian Node.js LTS Installer',
    autoHideMenuBar: true, // Hide the menu bar
    frame: true // Keep window frame but hide menu
  });

  // Load the HTML file
  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS it is common for applications to stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for file selection
ipcMain.handle('select-pem-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'PEM Files', extensions: ['pem'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// IPC handler for checking Node.js installation
ipcMain.handle('check-nodejs', async (event, config) => {
  try {
    // Progress callback to send updates to renderer
    const progressCallback = (message) => {
      event.sender.send('progress-update', message);
    };

    // Create installer instance with progress callback
    const installer = new NodeJSInstaller(progressCallback);

    // Set config with GUI values
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: config.privateKeyPath,
      passphrase: config.passphrase || undefined
    };

    // Validate the connection config
    installer.validateConnectionConfig(connectionConfig);

    // Set the config on the installer
    installer.config = connectionConfig;

    // Connect and check
    const conn = await installer.connect();

    try {
      const checkResult = await installer.checkNodeJSInstalled(conn);
      return {
        success: true,
        result: checkResult
      };
    } finally {
      conn.end();
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});

// IPC handler for installing Node.js
ipcMain.handle('install-nodejs', async (event, config) => {
  try {
    // Progress callback to send updates to renderer
    const progressCallback = (message) => {
      event.sender.send('progress-update', message);
    };

    // Create installer instance with progress callback
    const installer = new NodeJSInstaller(progressCallback);

    // Set config with GUI values
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: config.privateKeyPath,
      passphrase: config.passphrase || undefined
    };

    // Validate the connection config
    installer.validateConnectionConfig(connectionConfig);

    // Set the config on the installer
    installer.config = connectionConfig;

    // Connect and install
    const conn = await installer.connect();

    try {
      const installResult = await installer.installNodeJS(conn);
      return {
        success: true,
        result: installResult
      };
    } finally {
      conn.end();
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
});
