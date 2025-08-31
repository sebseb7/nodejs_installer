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

// Run the installer
if (require.main === module) {
    const installer = new NodeJSInstaller();
    installer.run().catch(console.error);
}

module.exports = NodeJSInstaller;
