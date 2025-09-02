const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import installer classes
const NodeJSInstaller = require('./index');
const NginxInstaller = require('./nginx-installer');
const BasicToolsInstaller = require('./basic-tools-installer');
const LetsEncryptInstaller = require('./letsencrypt-installer');
const StaticWebsiteInstaller = require('./static-website-installer');
const VSCodeWebInstaller = require('./vscode-web-installer');

// Import SSH key utilities (for OpenSSH format conversion)
const sshpk = require('sshpk');

// Keep a global reference of the window object
let mainWindow;

// Utility function to handle SSH key files
async function convertKeyFile(filePath, passphrase = null) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Check if it's a PPK file by looking for PPK header
    if (fileContent.startsWith('PuTTY-User-Key-File-')) {
      console.log('✅ Detected PPK file - SSH2 supports PPK format natively');
      return filePath;
    }

    // Handle OpenSSH format conversion (works reliably)
    if (fileContent.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
      console.log('Detected OpenSSH format, converting to traditional PEM...');
      try {
        const key = sshpk.parsePrivateKey(fileContent, 'openssh');
        const pemKey = key.toString('pem');

        const tempDir = os.tmpdir();
        const tempFileName = `converted-ssh-key-${Date.now()}.pem`;
        const tempFilePath = path.join(tempDir, tempFileName);

        fs.writeFileSync(tempFilePath, pemKey, 'utf8');
        fs.chmodSync(tempFilePath, 0o600);

        console.log('Successfully converted OpenSSH to PEM format');
        return tempFilePath;
      } catch (error) {
        console.log('OpenSSH conversion failed, using file as-is');
        return filePath;
      }
    }

    // Regular PEM files
    console.log('Using SSH key file (PEM format assumed)');
    return filePath;

  } catch (error) {
    console.error('Error processing SSH key file:', error);
    throw error;
  }
}

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
    title: 'Debian Development Stack Installer',
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
  // Set default path to Downloads folder
  const downloadsPath = path.join(os.homedir(), 'Downloads');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SSH Key Files', extensions: ['pem', 'ppk'] },
      { name: 'PEM Files', extensions: ['pem'] },
      { name: 'PPK Files', extensions: ['ppk'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: downloadsPath
  });

  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

// IPC handler for ZIP file selection
ipcMain.handle('select-zip-file', async () => {
  // Set default path to Downloads folder
  const downloadsPath = path.join(os.homedir(), 'Downloads');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: downloadsPath
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

    // Convert PPK file to OpenSSH format if needed
    const convertedKeyPath = await convertKeyFile(config.privateKeyPath, config.passphrase);

    // Set config with GUI values
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: convertedKeyPath,
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

// IPC handler for checking selected components
ipcMain.handle('check-selected', async (event, config) => {
  try {
    // Progress callback to send updates to renderer
    const progressCallback = (message) => {
      event.sender.send('progress-update', message);
    };

    // Convert PPK file to OpenSSH format if needed
    const convertedKeyPath = await convertKeyFile(config.privateKeyPath, config.passphrase);

    // Set up connection config
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: convertedKeyPath,
      passphrase: config.passphrase || undefined
    };

    // Validate the connection config
    const tempInstaller = new NodeJSInstaller();
    tempInstaller.validateConnectionConfig(connectionConfig);
    tempInstaller.config = connectionConfig;

    // Track check results
    const results = {
      nodejs: null,
      nginx: null,
      basicTools: null,
      ssl: null,
      staticWebsite: null,
      vscodeWeb: null
    };

    // Check selected components
    const conn = await tempInstaller.connect();

    try {
      // 1. Check Node.js if selected
      if (config.installOptions.nodejs) {
        event.sender.send('progress-update', '🔍 Checking Node.js installation...');
        const nodejsInstaller = new NodeJSInstaller(progressCallback);
        nodejsInstaller.config = connectionConfig;
        results.nodejs = await nodejsInstaller.checkNodeJSInstalled(conn);
      }

      // 2. Check Nginx if selected
      if (config.installOptions.nginx) {
        event.sender.send('progress-update', '🔍 Checking Nginx installation...');
        const nginxInstaller = new NginxInstaller(progressCallback);
        nginxInstaller.config = connectionConfig;
        results.nginx = await nginxInstaller.checkNginxInstalled(conn);
      }

      // 3. Check Basic Tools if selected
      if (config.installOptions.basicTools) {
        event.sender.send('progress-update', '🔍 Checking basic tools installation...');
        const basicToolsInstaller = new BasicToolsInstaller(progressCallback);
        basicToolsInstaller.config = connectionConfig;
        results.basicTools = await basicToolsInstaller.checkBasicToolsInstalled(conn);
      }

      // 4. Check SSL status if selected
      if (config.installOptions.letsEncrypt && config.sslConfig.domain) {
        event.sender.send('progress-update', `🔍 Checking SSL certificate status for ${config.sslConfig.domain}...`);
        const sslInstaller = new LetsEncryptInstaller(progressCallback);
        sslInstaller.config = connectionConfig;
        results.ssl = await sslInstaller.checkSSLStatus(conn, config.sslConfig.domain);
      }

      // 5. Check Static Website if selected
      if (config.installOptions.staticWebsite && config.staticWebsiteConfig.domain) {
        event.sender.send('progress-update', `🔍 Checking static website status for ${config.staticWebsiteConfig.domain}...`);
        const staticInstaller = new StaticWebsiteInstaller(progressCallback);
        staticInstaller.config = connectionConfig;
        results.staticWebsite = await staticInstaller.checkSSLStatus(conn, config.staticWebsiteConfig.domain);
      }

      // 6. Check VS Code Web if selected
      if (config.installOptions.vscodeWeb && config.vscodeWebConfig.domain) {
        event.sender.send('progress-update', `🔍 Checking VS Code Web status for ${config.vscodeWebConfig.domain}...`);
        const vscodeInstaller = new VSCodeWebInstaller(progressCallback);
        vscodeInstaller.config = connectionConfig;
        results.vscodeWeb = await vscodeInstaller.checkSSLStatus(conn, config.vscodeWebConfig.domain);
      }

      return {
        success: true,
        results: results
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

// IPC handler for starting nginx service
ipcMain.handle('start-nginx', async (event, config) => {
  try {
    // Progress callback to send updates to renderer
    const progressCallback = (message) => {
      event.sender.send('progress-update', message);
    };

    // Convert PPK file to OpenSSH format if needed
    const convertedKeyPath = await convertKeyFile(config.privateKeyPath, config.passphrase);

    // Set up connection config
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: convertedKeyPath,
      passphrase: config.passphrase || undefined
    };

    // Validate the connection config
    const tempInstaller = new NginxInstaller();
    tempInstaller.validateConnectionConfig(connectionConfig);
    tempInstaller.config = connectionConfig;

    // Connect and start nginx
    const conn = await tempInstaller.connect();

    try {
      const startResult = await tempInstaller.startNginx(conn);
      return {
        success: startResult.success,
        message: startResult.message
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

// IPC handler for installing selected components
ipcMain.handle('install-selected', async (event, config) => {
  try {
    // Progress callback to send updates to renderer
    const progressCallback = (message) => {
      event.sender.send('progress-update', message);
    };

    // Convert PPK file to OpenSSH format if needed
    const convertedKeyPath = await convertKeyFile(config.privateKeyPath, config.passphrase);

    // Set up connection config
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: convertedKeyPath,
      passphrase: config.passphrase || undefined
    };

    // Validate the connection config
    const tempInstaller = new NodeJSInstaller();
    tempInstaller.validateConnectionConfig(connectionConfig);
    tempInstaller.config = connectionConfig;

    // Track installation results
    const results = {
      nodejs: null,
      nginx: null,
      basicTools: null,
      letsEncrypt: null,
      staticWebsite: null
    };

    // Install selected components in order
    const conn = await tempInstaller.connect();

    try {
      // 1. Install Node.js if selected
      if (config.installOptions.nodejs) {
        event.sender.send('progress-update', '📦 Installing Node.js LTS...');
        const nodejsInstaller = new NodeJSInstaller(progressCallback);
        nodejsInstaller.config = connectionConfig;
        try {
          results.nodejs = await nodejsInstaller.installNodeJS(conn);
        } catch (error) {
          event.sender.send('progress-update', `❌ Node.js installation failed: ${error.message}`);
        }
      }

      // 2. Install Nginx if selected
      if (config.installOptions.nginx) {
        event.sender.send('progress-update', '🌐 Installing Nginx...');
        const nginxInstaller = new NginxInstaller(progressCallback);
        nginxInstaller.config = connectionConfig;
        try {
          results.nginx = await nginxInstaller.installNginx(conn);
        } catch (error) {
          event.sender.send('progress-update', `❌ Nginx installation failed: ${error.message}`);
        }
      }

      // 3. Install Basic Tools if selected
      if (config.installOptions.basicTools) {
        event.sender.send('progress-update', '🔧 Installing basic development tools...');
        const basicToolsInstaller = new BasicToolsInstaller(progressCallback);
        basicToolsInstaller.config = connectionConfig;
        try {
          results.basicTools = await basicToolsInstaller.installBasicTools(conn);
        } catch (error) {
          event.sender.send('progress-update', `❌ Basic tools installation failed: ${error.message}`);
        }
      }

      // 4. Install Let's Encrypt if selected (requires Nginx)
      if (config.installOptions.letsEncrypt) {
        if (!results.nginx || !results.nginx.installed) {
          event.sender.send('progress-update', '❌ Let\'s Encrypt requires Nginx. Skipping SSL setup.');
        } else {
          event.sender.send('progress-update', '🔒 Setting up Let\'s Encrypt SSL certificates...');
          const letsEncryptInstaller = new LetsEncryptInstaller(progressCallback);
          letsEncryptInstaller.config = connectionConfig;
          letsEncryptInstaller.setCertificateConfig(config.sslConfig.domain, config.sslConfig.email);
          try {
            results.letsEncrypt = await letsEncryptInstaller.installLetsEncrypt(conn);
          } catch (error) {
            event.sender.send('progress-update', `❌ Let's Encrypt setup failed: ${error.message}`);
          }
        }
      }

      // 5. Install Static Website if selected (requires Nginx and Basic Tools)
      if (config.installOptions.staticWebsite) {
        // Check if both Nginx and Basic Tools are installed
        const nginxInstalled = results.nginx && results.nginx.installed;
        const basicToolsInstalled = results.basicTools && results.basicTools.allInstalled;

        if (!nginxInstalled) {
          event.sender.send('progress-update', '❌ Static Website requires Nginx. Skipping static website setup.');
        } else if (!basicToolsInstalled) {
          event.sender.send('progress-update', '❌ Static Website requires Basic Tools (including unzip). Skipping static website setup.');
        } else {
          event.sender.send('progress-update', '🌐 Installing static website...');

          // Double-check nginx is accessible before proceeding
          const nginxDoubleCheck = await new Promise((resolve) => {
            conn.exec('command -v nginx >/dev/null 2>&1 && nginx -v 2>&1 | head -1', (err, stream) => {
              if (err) {
                resolve(false);
                return;
              }

              let output = '';
              stream.on('close', (code) => {
                resolve(code === 0);
              });
              stream.on('data', (data) => {
                output += data.toString();
              });
            });
          });

          if (!nginxDoubleCheck) {
            event.sender.send('progress-update', '⚠️ Nginx detected but not accessible. Attempting static website installation anyway...');
          }

          const staticWebsiteInstaller = new StaticWebsiteInstaller(progressCallback);
          staticWebsiteInstaller.config = connectionConfig;
          staticWebsiteInstaller.setWebsiteConfig(config.staticWebsiteConfig.domain, config.staticWebsiteConfig.zipFilePath);
          try {
            results.staticWebsite = await staticWebsiteInstaller.installStaticWebsite(conn);
          } catch (error) {
            event.sender.send('progress-update', `❌ Static website installation failed: ${error.message}`);
          }
        }
      }

      // 6. Install VS Code Web if selected (requires SSL certificate)
      if (config.installOptions.vscodeWeb) {
        event.sender.send('progress-update', '📝 Installing VS Code Web...');

        const vscodeWebInstaller = new VSCodeWebInstaller(progressCallback);
        vscodeWebInstaller.config = connectionConfig;
        vscodeWebInstaller.setVSCodeConfig(
          config.vscodeWebConfig.domain,
          config.vscodeWebConfig.path || '/code',
          config.vscodeWebConfig.password
        );

        try {
          // Fresh SSL check for VS Code Web (in case SSL was just installed)
          const freshSSLCheck = await vscodeWebInstaller.checkSSLStatus(conn, config.vscodeWebConfig.domain);

          if (!freshSSLCheck.hasSSL) {
            event.sender.send('progress-update', '❌ VS Code Web requires SSL certificate. Please ensure SSL is properly installed.');
            results.vscodeWeb = { success: false, error: 'SSL certificate not found' };
          } else {
            results.vscodeWeb = await vscodeWebInstaller.installVSCodeWeb(conn);
          }
        } catch (error) {
          event.sender.send('progress-update', `❌ VS Code Web installation failed: ${error.message}`);
          results.vscodeWeb = { success: false, error: error.message };
        }
      }

      return {
        success: true,
        results: results
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

    // Convert PPK file to OpenSSH format if needed
    const convertedKeyPath = await convertKeyFile(config.privateKeyPath, config.passphrase);

    // Set config with GUI values
    const connectionConfig = {
      host: config.host,
      port: parseInt(config.port) || 22,
      username: config.username,
      privateKeyPath: convertedKeyPath,
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