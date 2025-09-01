#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');

class BasicToolsInstaller {
    constructor(progressCallback = null) {
        this.config = {};
        this.progressCallback = progressCallback;
        // Mapping of command names to package names
        // command: the name used to check if tool is available (command -v)
        // package: the name used to install the tool (apt install)
        // Add new tools here following the pattern: 'toolKey': { command: 'commandName', package: 'packageName' }
        this.toolMapping = {
            'git': { command: 'git', package: 'git' },
            'htop': { command: 'htop', package: 'htop' },
            'ripgrep': { command: 'rg', package: 'ripgrep' },
            'build-essential': { command: 'gcc', package: 'build-essential' },
            'curl': { command: 'curl', package: 'curl' },
            'wget': { command: 'wget', package: 'wget' },
            'vim': { command: 'vim', package: 'vim-nox' },
            'mc': { command: 'mc', package: 'mc' },
            'unzip': { command: 'unzip', package: 'unzip' }
        };

        // Generate tools array from mapping for backward compatibility
        this.tools = Object.keys(this.toolMapping);
    }

    // Helper methods to get command/package names
    getCommandName(tool) {
        return this.toolMapping[tool]?.command || tool;
    }

    getPackageName(tool) {
        return this.toolMapping[tool]?.package || tool;
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

    async checkToolInstalled(conn, tool) {
        try {
            const commandName = this.getCommandName(tool);
            const checkResult = await this.executeCommand(
                conn,
                `command -v ${commandName} >/dev/null 2>&1 && echo "installed"`,
                `Checking ${tool} installation`,
                true
            );

            return checkResult.exitCode === 0 && checkResult.output.trim() === 'installed';
        } catch (error) {
            return false;
        }
    }

    async checkBasicToolsInstalled(conn) {
        this.log('🔍 Checking installation status of basic tools...');

        const installedTools = [];
        const missingTools = [];

        for (const tool of this.tools) {
            const isInstalled = await this.checkToolInstalled(conn, tool);
            if (isInstalled) {
                installedTools.push(tool);
            } else {
                missingTools.push(tool);
            }
        }

        if (installedTools.length > 0) {
            this.log(`✅ Already installed: ${installedTools.join(', ')}`);
        }

        if (missingTools.length > 0) {
            this.log(`❌ Missing tools: ${missingTools.join(', ')}`);
        }

        return {
            installed: installedTools,
            missing: missingTools,
            allInstalled: missingTools.length === 0
        };
    }

    async installBasicTools(conn) {
        // Check current status
        const checkResult = await this.checkBasicToolsInstalled(conn);

        if (checkResult.allInstalled) {
            this.log('✅ All basic tools are already installed!');
            this.log(`📋 Installed tools: ${checkResult.installed.join(', ')}`);
            return checkResult;
        }

        this.log('🚀 Installing missing basic tools...');

        try {
            // Update package list
            await this.executeCommand(
                conn,
                'sudo apt update',
                'Updating package list'
            );

            // Install missing tools using package names
            const packagesToInstall = checkResult.missing
                .map(tool => this.getPackageName(tool))
                .join(' ');

            if (packagesToInstall) {
                await this.executeCommand(
                    conn,
                    `sudo apt install -y ${packagesToInstall}`,
                    `Installing basic tools: ${packagesToInstall}`
                );
            }

            // Verify installation
            const finalCheck = await this.checkBasicToolsInstalled(conn);

            if (finalCheck.allInstalled) {
                this.log('🎉 Basic tools installation completed successfully!');
                const installedCommands = finalCheck.installed.map(tool => this.getCommandName(tool));
                this.log(`📋 All tools installed: ${installedCommands.join(', ')}`);
                return { installed: finalCheck.installed, missing: [], allInstalled: true };
            } else {
                this.log(`⚠️ Some tools may not have installed properly. Still missing: ${finalCheck.missing.join(', ')}`);
                return finalCheck;
            }

        } catch (error) {
            this.log(`❌ Basic tools installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installBasicTools(conn);

            if (result.allInstalled) {
                this.log('✅ Basic tools setup completed successfully!');
                const installedCommands = result.installed.map(tool => this.getCommandName(tool));
                this.log(`📋 Final installed tools: ${installedCommands.join(', ')}`);
            } else {
                this.log('⚠️ Basic tools setup completed with warnings!');
                if (result.missing.length > 0) {
                    this.log(`📋 Missing tools: ${result.missing.join(', ')}`);
                }
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

// Run the installer if this file is executed directly
if (require.main === module) {
    const installer = new BasicToolsInstaller();
    installer.run().catch(console.error);
}

module.exports = BasicToolsInstaller;
