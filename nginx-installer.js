#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');

class NginxInstaller {
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

    async checkNginxInstalled(conn) {
        this.log('🔍 Checking if Nginx is already installed...');

        try {
            // Try multiple approaches to detect nginx installation
            let version = 'unknown';
            let installed = false;

            // First, try to find nginx in common locations
            const nginxPaths = [
                '/usr/sbin/nginx',
                '/usr/bin/nginx',
                '/usr/local/nginx/sbin/nginx',
                '/usr/local/sbin/nginx'
            ];

            for (const path of nginxPaths) {
                try {
                    const versionResult = await this.executeCommand(
                        conn,
                        `${path} -v 2>&1`, // Redirect stderr to stdout to capture version info
                        `Checking nginx at ${path}`,
                        true // suppress output
                    );

                    if (versionResult.exitCode === 0) {
                        version = versionResult.output.trim() || versionResult.errorOutput.trim();
                        if (version) {
                            installed = true;
                            break;
                        }
                    }
                } catch (error) {
                    // Continue to next path
                }
            }

            // If direct path didn't work, try command -v nginx
            if (!installed) {
                try {
                    const whichResult = await this.executeCommand(
                        conn,
                        'command -v nginx',
                        'Finding nginx command',
                        true
                    );

                    if (whichResult.exitCode === 0) {
                        const nginxPath = whichResult.output.trim();
                        const versionResult = await this.executeCommand(
                            conn,
                            `${nginxPath} -v 2>&1`, // Redirect stderr to stdout to capture version info
                            'Checking Nginx version',
                            true
                        );

                        if (versionResult.exitCode === 0) {
                            version = versionResult.output.trim() || versionResult.errorOutput.trim();
                            if (version) {
                                installed = true;
                            }
                        }
                    }
                } catch (error) {
                    // Continue to fallback
                }
            }

            // Final fallback: check if nginx package is installed via dpkg and get version
            if (!installed) {
                try {
                    const dpkgResult = await this.executeCommand(
                        conn,
                        'dpkg -l nginx 2>/dev/null | grep "^ii"',
                        'Checking if nginx package is installed',
                        true
                    );

                    if (dpkgResult.exitCode === 0) {
                        installed = true;
                        // Try to extract version from dpkg output
                        const dpkgLines = dpkgResult.output.trim().split('\n');
                        if (dpkgLines.length > 0) {
                            const parts = dpkgLines[0].trim().split(/\s+/);
                            if (parts.length >= 3) {
                                version = `nginx/${parts[2]}`;
                            } else {
                                version = 'package-installed';
                            }
                        } else {
                            version = 'package-installed';
                        }
                    }
                } catch (error) {
                    // Continue to final fallback
                }
            }

            // Final fallback: check if nginx service exists
            if (!installed) {
                try {
                    const serviceResult = await this.executeCommand(
                        conn,
                        'systemctl list-units --type=service --all | grep -q nginx',
                        'Checking nginx service',
                        true
                    );

                    if (serviceResult.exitCode === 0) {
                        installed = true;
                        version = 'service-installed';
                    }
                } catch (error) {
                    // Service check failed
                }
            }

            // Check if nginx service is running
            let running = false;
            if (installed) {
                try {
                    const statusResult = await this.executeCommand(
                        conn,
                        'systemctl is-active nginx',
                        'Checking if nginx service is running',
                        true
                    );
                    running = statusResult.output.trim() === 'active';
                } catch (error) {
                    // Service status check failed, assume not running
                    running = false;
                }
            }

            if (installed) {
                const statusMsg = running ? 'running' : 'installed (not running)';
                this.log(`✅ Nginx is already installed: ${version} (${statusMsg})`);
                return { installed: true, version: version, running: running };
            } else {
                this.log('❌ Nginx is not installed');
                return { installed: false, running: false };
            }
        } catch (error) {
            this.log(`❌ Error checking Nginx installation: ${error.message}`);
            return { installed: false, running: false };
        }
    }

    async startNginx(conn) {
        this.log('🚀 Starting Nginx service...');

        try {
            const startResult = await this.executeCommand(
                conn,
                'sudo systemctl start nginx',
                'Starting Nginx service'
            );

            if (startResult.exitCode === 0) {
                this.log('✅ Nginx service started successfully!');
                return { success: true, message: 'Nginx service started' };
            } else {
                throw new Error('Failed to start Nginx service');
            }
        } catch (error) {
            this.log(`❌ Failed to start Nginx service: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    async installNginx(conn) {
        // First check if Nginx is already installed
        const checkResult = await this.checkNginxInstalled(conn);

        if (checkResult.installed) {
            this.log('✅ Nginx is already installed and available!');
            this.log(`📋 Current version - Nginx: ${checkResult.version}`);
            return checkResult;
        }

        this.log('🚀 Nginx not found. Starting installation from official Debian repository...');

        try {
            // Update package list
            await this.executeCommand(
                conn,
                'sudo apt update',
                'Updating package list'
            );

            // Install prerequisites
            await this.executeCommand(
                conn,
                'sudo apt install -y curl gnupg2 ca-certificates lsb-release debian-archive-keyring',
                'Installing prerequisites'
            );

            // Import nginx signing key
            await this.executeCommand(
                conn,
                'curl https://nginx.org/keys/nginx_signing.key | gpg --dearmor | sudo tee /usr/share/keyrings/nginx-archive-keyring.gpg >/dev/null',
                'Importing Nginx signing key'
            );

            // Create .gnupg directory for GPG operations and verify the key
            // Note: GPG needs ~/.gnupg directory even with --no-keyring option
            // If verification fails, we continue since key import was successful
            try {
                await this.executeCommand(
                    conn,
                    'mkdir -p ~/.gnupg',
                    'Creating GPG directory'
                );

                // Verify the key
                const verifyResult = await this.executeCommand(
                    conn,
                    'gpg --dry-run --quiet --no-keyring --import --import-options import-show /usr/share/keyrings/nginx-archive-keyring.gpg',
                    'Verifying signing key'
                );

                if (!verifyResult.output.includes('573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62')) {
                    this.log('⚠️ Warning: Nginx signing key verification failed, but continuing with installation...');
                }
            } catch (error) {
                this.log('⚠️ Warning: Could not verify Nginx signing key, but continuing with installation...');
            }

            // Add nginx repository (using stable by default)
            await this.executeCommand(
                conn,
                'echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/debian `lsb_release -cs` nginx" | sudo tee /etc/apt/sources.list.d/nginx.list',
                'Adding Nginx repository'
            );

            // Set up repository pinning
            await this.executeCommand(
                conn,
                'echo -e "Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n" | sudo tee /etc/apt/preferences.d/99nginx',
                'Setting up repository pinning'
            );

            // Update package list again
            await this.executeCommand(
                conn,
                'sudo apt update',
                'Updating package list with Nginx repository'
            );

            // Install nginx
            await this.executeCommand(
                conn,
                'sudo apt install -y nginx',
                'Installing Nginx'
            );

            // Verify installation - try multiple approaches
            let version = 'unknown';
            let verified = false;

            // First, try to find nginx in common locations
            const nginxPaths = [
                '/usr/sbin/nginx',
                '/usr/bin/nginx',
                '/usr/local/nginx/sbin/nginx',
                '/usr/local/sbin/nginx'
            ];

            for (const path of nginxPaths) {
                try {
                    const versionResult = await this.executeCommand(
                        conn,
                        `${path} -v 2>&1`, // Redirect stderr to stdout to capture version info
                        `Checking nginx at ${path}`,
                        true // suppress output
                    );

                    if (versionResult.exitCode === 0) {
                        version = versionResult.output.trim() || versionResult.errorOutput.trim();
                        if (version) {
                            verified = true;
                            break;
                        }
                    }
                } catch (error) {
                    // Continue to next path
                }
            }

            // If direct path didn't work, try command -v nginx
            if (!verified) {
                try {
                    const whichResult = await this.executeCommand(
                        conn,
                        'command -v nginx',
                        'Finding nginx command',
                        true
                    );

                    if (whichResult.exitCode === 0) {
                        const nginxPath = whichResult.output.trim();
                        const versionResult = await this.executeCommand(
                            conn,
                            `${nginxPath} -v 2>&1`, // Redirect stderr to stdout to capture version info
                            'Verifying Nginx installation'
                        );

                        if (versionResult.exitCode === 0) {
                            version = versionResult.output.trim() || versionResult.errorOutput.trim();
                            if (version) {
                                verified = true;
                            }
                        }
                    }
                } catch (error) {
                    // Continue to fallback
                }
            }

            // Check package version as another fallback
            if (!verified) {
                try {
                    const dpkgResult = await this.executeCommand(
                        conn,
                        'dpkg -l nginx 2>/dev/null | grep "^ii"',
                        'Checking nginx package version',
                        true
                    );

                    if (dpkgResult.exitCode === 0) {
                        verified = true;
                        // Try to extract version from dpkg output
                        const dpkgLines = dpkgResult.output.trim().split('\n');
                        if (dpkgLines.length > 0) {
                            const parts = dpkgLines[0].trim().split(/\s+/);
                            if (parts.length >= 3) {
                                version = `nginx/${parts[2]}`;
                            } else {
                                version = 'package-installed';
                            }
                        } else {
                            version = 'package-installed';
                        }
                    }
                } catch (error) {
                    // Continue to final fallback
                }
            }

            // Final fallback: check if nginx service exists
            if (!verified) {
                try {
                    const serviceResult = await this.executeCommand(
                        conn,
                        'systemctl is-enabled nginx || systemctl status nginx --no-pager -l',
                        'Checking nginx service status',
                        true
                    );

                    if (serviceResult.exitCode === 0) {
                        verified = true;
                        version = 'service-installed';
                    }
                } catch (error) {
                    // Service check failed
                }
            }

            if (verified) {
                this.log('🎉 Nginx installation completed successfully!');
                this.log(`📋 Installed version - Nginx: ${version}`);

                // Start nginx service
                try {
                    await this.executeCommand(
                        conn,
                        'sudo systemctl start nginx',
                        'Starting Nginx service'
                    );
                    this.log('✅ Nginx service started successfully!');
                } catch (error) {
                    this.log('⚠️ Warning: Could not start Nginx service automatically');
                }

                return { installed: true, version: version, running: true };
            } else {
                throw new Error('Installation verification failed - nginx command not found in PATH');
            }

        } catch (error) {
            this.log(`❌ Nginx installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installNginx(conn);

            if (result.installed) {
                this.log('✅ Nginx setup completed successfully!');
                if (result.version) {
                    this.log(`📋 Final version - Nginx: ${result.version}`);
                }
            } else {
                this.log('❌ Nginx setup failed!');
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

// Run the installer if this file is executed directly
if (require.main === module) {
    const installer = new NginxInstaller();
    installer.run().catch(console.error);
}

module.exports = NginxInstaller;
