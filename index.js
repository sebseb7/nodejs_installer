#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

class NodeJSInstaller {
    constructor(progressCallback = null) {
        this.config = {};
        this.progressCallback = progressCallback;
    }

    log(message) {
        console.log(message);
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }

    validateConnectionConfig(config) {
        const required = ['host', 'privateKeyPath'];
        const missing = required.filter(key => !config[key]);

        if (missing.length > 0) {
            const errorMsg = `❌ Missing required configuration: ${missing.join(', ')}`;
            this.log(errorMsg);
            throw new Error(errorMsg);
        }

        if (!fs.existsSync(config.privateKeyPath)) {
            const errorMsg = `❌ SSH private key file not found: ${config.privateKeyPath}`;
            this.log(errorMsg);
            throw new Error(errorMsg);
        }

        this.log('✅ Configuration validated');
    }

    async connect() {
        return new Promise((resolve, reject) => {
            const conn = new Client();

            this.log(`🔗 Connecting to ${this.config.username}@${this.config.host}:${this.config.port}...`);

            conn.on('ready', () => {
                this.log('✅ SSH connection established');
                resolve(conn);
            });

            conn.on('error', (err) => {
                this.log(`❌ SSH connection failed: ${err.message}`);
                reject(err);
            });

            const connectConfig = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                privateKey: fs.readFileSync(this.config.privateKeyPath)
            };

            if (this.config.passphrase) {
                connectConfig.passphrase = this.config.passphrase;
            }

            conn.connect(connectConfig);
        });
    }

    async executeCommand(conn, command, description, suppressOutput = false) {
        return new Promise((resolve, reject) => {
            if (!suppressOutput) {
                this.log(`🔄 ${description}...`);
            }

            conn.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                let errorOutput = '';

                stream.on('close', (code, signal) => {
                    if (code === 0) {
                        if (!suppressOutput) {
                            this.log(`✅ ${description} completed`);
                        }
                        resolve({ output, errorOutput, exitCode: code });
                    } else {
                        if (!suppressOutput) {
                            this.log(`❌ ${description} failed (exit code: ${code})`);
                            if (errorOutput) {
                                this.log(`Error output: ${errorOutput}`);
                            }
                        }
                        resolve({ output, errorOutput, exitCode: code });
                    }
                });

                stream.on('data', (data) => {
                    output += data.toString();
                    if (!suppressOutput) {
                        this.log(data.toString().trim());
                    }
                });

                stream.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                    if (!suppressOutput) {
                        this.log(`STDERR: ${data.toString().trim()}`);
                    }
                });
            });
        });
    }

    async checkNodeJSInstalled(conn) {
        this.log('🔍 Checking if Node.js is already installed...');

        try {
            // Check if node command exists
            const nodeCheck = await this.executeCommand(
                conn,
                'command -v node >/dev/null 2>&1 && node --version',
                'Checking Node.js version',
                true
            );

            if (nodeCheck.exitCode === 0) {
                const nodeVersion = nodeCheck.output.trim();
                this.log(`✅ Node.js is already installed: ${nodeVersion}`);

                // Also check npm version
                const npmCheck = await this.executeCommand(
                    conn,
                    'command -v npm >/dev/null 2>&1 && npm --version',
                    'Checking npm version',
                    true
                );

                if (npmCheck.exitCode === 0) {
                    const npmVersion = npmCheck.output.trim();
                    this.log(`✅ npm is available: ${npmVersion}`);
                }

                return {
                    installed: true,
                    nodeVersion: nodeVersion,
                    npmVersion: npmCheck.exitCode === 0 ? npmCheck.output.trim() : null
                };
            } else {
                this.log('❌ Node.js is not installed');
                return { installed: false };
            }
        } catch (error) {
            this.log(`❌ Error checking Node.js installation: ${error.message}`);
            return { installed: false };
        }
    }

    async installNodeJS(conn) {
        // First check if Node.js is already installed
        const checkResult = await this.checkNodeJSInstalled(conn);

        if (checkResult.installed) {
            this.log('✅ Node.js is already installed and available!');
            this.log(`📋 Current versions - Node.js: ${checkResult.nodeVersion}${checkResult.npmVersion ? `, npm: ${checkResult.npmVersion}` : ''}`);
            return checkResult;
        }

        this.log('🚀 Node.js not found. Starting installation from NodeSource...');

        try {
            // Update package list
            await this.executeCommand(
                conn,
                'sudo apt update',
                'Updating package list'
            );

            // Install curl (required for NodeSource setup, software-properties-common not needed on Debian)
            await this.executeCommand(
                conn,
                'sudo apt install -y curl',
                'Installing curl'
            );

            // Add NodeSource repository
            await this.executeCommand(
                conn,
                'curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -',
                'Adding NodeSource repository'
            );

            // Install Node.js LTS
            await this.executeCommand(
                conn,
                'sudo apt install -y nodejs',
                'Installing Node.js LTS'
            );

            // Verify installation
            const versionResult = await this.executeCommand(
                conn,
                'node --version && npm --version',
                'Verifying Node.js installation'
            );

            if (versionResult.exitCode === 0) {
                this.log('🎉 Node.js LTS installation completed successfully!');
                const versions = versionResult.output.trim().split('\n');
                this.log(`📋 Installed versions - Node.js: ${versions[0] || 'unknown'}, npm: ${versions[1] || 'unknown'}`);
                return { installed: true, nodeVersion: versions[0], npmVersion: versions[1] };
            } else {
                throw new Error('Installation verification failed');
            }

        } catch (error) {
            this.log(`❌ Node.js installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installNodeJS(conn);

            if (result.installed) {
                this.log('✅ Node.js setup completed successfully!');
                if (result.nodeVersion) {
                    this.log(`📋 Final versions - Node.js: ${result.nodeVersion}${result.npmVersion ? `, npm: ${result.npmVersion}` : ''}`);
                }
            } else {
                this.log('❌ Node.js setup failed!');
                process.exit(1);
            }
        } catch (error) {
            this.log(`❌ Installation failed: ${error.message}`);
            process.exit(1);
        } finally {
            if (conn) {
                conn.end();
                this.log('🔌 SSH connection closed');
            }
        }
    }
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--host':
            case '-h':
                config.host = args[++i];
                break;
            case '--username':
            case '-u':
                config.username = args[++i];
                break;
            case '--key':
            case '-k':
                config.privateKeyPath = args[++i];
                break;
            case '--port':
            case '-p':
                config.port = parseInt(args[++i]) || 22;
                break;
            case '--passphrase':
                config.passphrase = args[++i];
                break;
            case '--help':
                showHelp();
                process.exit(0);
        }
    }

    return config;
}

function showHelp() {
    console.log(`
Node.js Installer - Command Line Interface

USAGE:
  node index.js [OPTIONS]

REQUIRED OPTIONS:
  --host, -h HOST          SSH host/IP address
  --username, -u USER      SSH username (usually 'admin' for Debian)
  --key, -k PATH           Path to SSH private key file

OPTIONAL:
  --port, -p PORT          SSH port (default: 22)
  --passphrase PASS        SSH key passphrase (if required)
  --help                   Show this help

EXAMPLES:
  # Basic usage
  node index.js --host 18.195.241.96 --username admin --key 18.195.241.96.pem

  # Short form
  node index.js -h 18.195.241.96 -u admin -k ./my-key.pem

  # With custom SSH port
  node index.js --host ec2-instance.com --username debian --key ./key.pem --port 2222

PREREQUISITES:
  - SSH access to target Debian/Ubuntu server
  - Basic tools installed (recommended)

WHAT IT INSTALLS:
  - Node.js LTS (latest stable version)
  - npm (Node Package Manager)
  - Node.js development tools
  - Global npm packages for development

FEATURES:
  - Installs Node.js from NodeSource repository
  - Automatic PATH configuration
  - npm and node commands available system-wide
  - Compatible with Debian/Ubuntu systems

NOTES:
  - Ensure SSH key has proper permissions (chmod 600 key.pem)
  - The script installs Node.js LTS from NodeSource
  - npm is included with Node.js installation
`);
}

// Run the installer
if (require.main === module) {
    const config = parseArgs();

    if (Object.keys(config).length === 0) {
        console.error('❌ No configuration provided!');
        console.error('Use --help for usage instructions.');
        process.exit(1);
    }

    // Check required parameters
    const required = ['host', 'username', 'privateKeyPath'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
        console.error('Use --help for usage instructions.');
        process.exit(1);
    }

    // Set defaults
    config.port = config.port || 22;
    config.username = config.username || 'admin';

    const installer = new NodeJSInstaller();
    installer.config = config;

    installer.run().catch(console.error);
}

module.exports = NodeJSInstaller;
