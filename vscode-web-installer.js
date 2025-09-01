#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');

class VSCodeWebInstaller {
    constructor(progressCallback = null) {
        this.config = {};
        this.progressCallback = progressCallback;
        this.domain = null;
        this.path = null;
        this.password = null;
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

    setVSCodeConfig(domain, path = '/code', password) {
        this.domain = domain;
        this.path = path;
        this.password = password;
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

    async checkSSLStatus(conn, domain) {
        this.log(`🔍 Checking SSL certificate status for ${domain}...`);

        try {
            const sslCheck = await this.executeCommand(
                conn,
                `sudo ls /etc/letsencrypt/live/${domain}/fullchain.pem >/dev/null 2>&1 && echo "SSL exists" || echo "SSL not found"`,
                'Checking SSL certificate status',
                true
            );

            if (sslCheck.output.includes('SSL exists')) {
                this.log(`✅ SSL certificate found for ${domain}`);
                return { hasSSL: true };
            } else {
                this.log(`❌ SSL certificate not found for ${domain}`);
                this.log('❌ VS Code Web requires SSL certificate to be installed first');
                return { hasSSL: false };
            }
        } catch (error) {
            this.log(`❌ Error checking SSL status: ${error.message}`);
            return { hasSSL: false };
        }
    }

    async installCodeServer(conn) {
        this.log('🚀 Installing VS Code Web (code-server)...');

        try {
            // Install code-server using the official installation script
            await this.executeCommand(
                conn,
                'curl -fsSL https://code-server.dev/install.sh | sudo sh',
                'Downloading and running code-server installation script'
            );

            // Enable the service for the current user
            await this.executeCommand(
                conn,
                `sudo systemctl enable --now code-server@$USER`,
                'Enabling code-server service'
            );

            // Start the service
            await this.executeCommand(
                conn,
                `sudo systemctl start --now code-server@$USER`,
                'Starting code-server service'
            );

            // Verify installation
            const verifyResult = await this.executeCommand(
                conn,
                'sudo systemctl status code-server@$USER --no-pager -l',
                'Verifying code-server service status',
                true
            );

            if (verifyResult.exitCode === 0 && verifyResult.output.includes('active (running)')) {
                this.log('✅ VS Code Web (code-server) installed and running successfully');
                return true;
            } else {
                this.log('⚠️ Code-server service may not be running properly');
                this.log('Service status output:', verifyResult.output);
                return false;
            }

        } catch (error) {
            this.log(`❌ Code-server installation failed: ${error.message}`);
            throw error;
        }
    }

    async generateHashedPassword(password) {
        this.log('🔐 Generating argon2 hashed password...');

        try {
            // Generate argon2 hash for the password
            const hashedPassword = await argon2.hash(password);
            this.log('✅ Password hashed successfully');
            return hashedPassword;
        } catch (error) {
            this.log(`❌ Password hashing failed: ${error.message}`);
            throw error;
        }
    }

    async createCodeServerConfig(conn, hashedPassword) {
        this.log('⚙️ Creating code-server configuration...');

        try {
            // Ensure the config directory exists
            await this.executeCommand(
                conn,
                'mkdir -p ~/.config/code-server',
                'Creating code-server config directory'
            );

            // Create the config.yaml file
            const configContent = `bind-addr: 127.0.0.1:8080
auth: password
hashed-password: ${hashedPassword}
cert: false
`;

            // Write the configuration file
            await this.executeCommand(
                conn,
                `cat > ~/.config/code-server/config.yaml << 'EOF'
${configContent}
EOF`,
                'Creating code-server configuration file'
            );

            // Restart code-server to apply new configuration
            await this.executeCommand(
                conn,
                `sudo systemctl restart code-server@$USER`,
                'Restarting code-server with new configuration'
            );

            this.log('✅ Code-server configuration created successfully');
            return true;

        } catch (error) {
            this.log(`❌ Code-server configuration failed: ${error.message}`);
            throw error;
        }
    }

    async updateNginxConfig(conn, domain, path) {
        this.log(`🌐 Updating nginx configuration for ${domain}${path}...`);

        try {
            // First, read the existing nginx config to understand its structure
            const readConfig = await this.executeCommand(
                conn,
                `sudo cat /etc/nginx/conf.d/${domain}.conf`,
                'Reading existing nginx configuration',
                true
            );

            if (readConfig.exitCode !== 0) {
                throw new Error('Could not read existing nginx configuration');
            }

            const existingConfig = readConfig.output;

            // Check if the VS Code Web location block already exists
            if (existingConfig.includes(`location ${path}/ {`)) {
                this.log(`⚠️ VS Code Web location block already exists for ${path}`);
                return true;
            }

            // Add the VS Code Web proxy location block to the HTTPS server section
            const proxyBlock = `
    location ${path}/ {
        proxy_pass  http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
    }`;

            // Insert the proxy block into the HTTPS server section
            let updatedConfig = existingConfig;

            // Find the HTTPS server block and add the location before the closing brace
            const httpsServerMatch = /server \{[^}]*listen 443[^}]*\}/s;
            if (httpsServerMatch.test(existingConfig)) {
                // Insert before the last closing brace of the HTTPS server block
                updatedConfig = existingConfig.replace(
                    /(server \{[^}]*listen 443[^}]*)(\}[^}]*$)/s,
                    `$1${proxyBlock}\n    }$2`
                );
            } else {
                throw new Error('Could not find HTTPS server block in nginx configuration');
            }

            // Write the updated configuration
            await this.executeCommand(
                conn,
                `cat > /tmp/${domain}-updated.conf << 'EOF'
${updatedConfig}
EOF`,
                'Creating updated nginx configuration'
            );

            // Move to nginx directory
            await this.executeCommand(
                conn,
                `sudo mv /tmp/${domain}-updated.conf /etc/nginx/conf.d/${domain}.conf`,
                'Moving updated nginx configuration'
            );

            // Test nginx configuration
            const testResult = await this.executeCommand(
                conn,
                'sudo nginx -t',
                'Testing nginx configuration'
            );

            if (testResult.exitCode !== 0) {
                throw new Error('Nginx configuration test failed');
            }

            // Reload nginx
            await this.executeCommand(
                conn,
                'sudo systemctl reload nginx',
                'Reloading nginx configuration'
            );

            this.log('✅ Nginx configuration updated successfully');
            return true;

        } catch (error) {
            this.log(`❌ Nginx configuration update failed: ${error.message}`);
            throw error;
        }
    }

    async installVSCodeWeb(conn) {
        if (!this.domain || !this.password) {
            throw new Error('Domain and password are required');
        }

        this.log('🚀 Starting VS Code Web installation...');

        try {
            // Step 1: Check if SSL certificate exists (required)
            const sslStatus = await this.checkSSLStatus(conn, this.domain);
            if (!sslStatus.hasSSL) {
                throw new Error('SSL certificate is required for VS Code Web installation');
            }

            // Step 2: Install code-server
            const installResult = await this.installCodeServer(conn);
            if (!installResult) {
                throw new Error('Code-server installation failed');
            }

            // Step 3: Generate hashed password
            const hashedPassword = await this.generateHashedPassword(this.password);

            // Step 4: Create code-server configuration
            await this.createCodeServerConfig(conn, hashedPassword);

            // Step 5: Update nginx configuration
            await this.updateNginxConfig(conn, this.domain, this.path);

            this.log('🎉 VS Code Web installation completed successfully!');
            this.log(`📋 Domain: ${this.domain}`);
            this.log(`📋 Path: ${this.path}`);
            this.log(`🔗 VS Code Web will be available at: https://${this.domain}${this.path}`);
            this.log(`🔑 Password: ${this.password} (hashed and stored securely)`);

            return {
                success: true,
                domain: this.domain,
                path: this.path,
                url: `https://${this.domain}${this.path}`,
                password: this.password
            };

        } catch (error) {
            this.log(`❌ VS Code Web installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installVSCodeWeb(conn);

            if (result.success) {
                this.log('✅ VS Code Web setup completed successfully!');
            }
        } catch (error) {
            this.log(`❌ Setup failed: ${error.message}`);
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
    const installer = new VSCodeWebInstaller();
    installer.run().catch(console.error);
}

module.exports = VSCodeWebInstaller;
