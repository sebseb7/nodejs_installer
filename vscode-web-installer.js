#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2-browser');

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
            // First, check if the certificate files exist
            const sslFileCheck = await this.executeCommand(
                conn,
                `sudo test -f /etc/letsencrypt/live/${domain}/fullchain.pem && sudo test -f /etc/letsencrypt/live/${domain}/privkey.pem && echo "SSL files exist" || echo "SSL files missing"`,
                'Checking SSL certificate files',
                true
            );

            this.log(`SSL file check result: ${sslFileCheck.output.trim()}`);

            // Also check if nginx can read the files (permissions)
            const sslAccessCheck = await this.executeCommand(
                conn,
                `sudo -u nginx test -r /etc/letsencrypt/live/${domain}/fullchain.pem 2>/dev/null && echo "nginx can read SSL" || echo "nginx cannot read SSL"`,
                'Checking SSL file permissions for nginx',
                true
            );

            this.log(`SSL access check result: ${sslAccessCheck.output.trim()}`);

            if (sslFileCheck.output.includes('SSL files exist')) {
                this.log(`✅ SSL certificate found for ${domain}`);
                return { hasSSL: true };
            } else {
                this.log(`❌ SSL certificate files not found for ${domain}`);
                this.log('❌ VS Code Web requires SSL certificate to be installed first');
                this.log(`Expected files: /etc/letsencrypt/live/${domain}/fullchain.pem and privkey.pem`);

                // List what's actually in the letsencrypt directory
                const listLetsencrypt = await this.executeCommand(
                    conn,
                    `sudo ls -la /etc/letsencrypt/live/ 2>/dev/null || echo "letsencrypt directory not found"`,
                    'Listing letsencrypt certificates',
                    true
                );
                this.log(`Available certificates: ${listLetsencrypt.output.trim()}`);

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
            // Generate argon2 hash for the password using argon2-browser API
            const hash = await argon2.hash({
                pass: password,
                salt: 'randomsalt' + Math.random().toString(36).substring(2, 15)
            });

            this.log('✅ Password hashed successfully');
            return hash.encoded;
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

    async createWebrootDirectory(conn) {
        this.log('📁 Creating webroot directory...');

        try {
            // Detect the user's actual home directory
            const homeDirResult = await this.executeCommand(
                conn,
                `getent passwd ${this.config.username} | cut -d: -f6`,
                'Detecting user home directory'
            );

            const userHomeDir = homeDirResult.output.trim();
            this.log(`🏠 User home directory: ${userHomeDir}`);

            // Store the detected home directory for use in nginx config
            this.userHomeDir = userHomeDir;

            // Create the webroot parent directory if it doesn't exist
            await this.executeCommand(
                conn,
                `sudo mkdir -p ${userHomeDir}/webroot`,
                'Creating webroot parent directory'
            );

            // Create domain-specific webroot directory
            await this.executeCommand(
                conn,
                `sudo mkdir -p ${userHomeDir}/webroot/${this.domain}`,
                'Creating domain webroot directory'
            );

            // Ensure home directory is accessible to nginx
            const homePerms = await this.executeCommand(
                conn,
                `stat -c '%a' ${userHomeDir}`,
                'Checking home directory permissions'
            );

            const homePermStr = homePerms.output.trim();
            const worldPerm = parseInt(homePermStr.charAt(2)); // Last digit = world permissions

            this.log(`🏠 Home directory permissions: ${homePermStr} (world: ${worldPerm})`);

            // Check if world has execute permission (needed for nginx to traverse)
            // Execute permission = 1 (execute only), 3 (write+execute), 5 (read+execute), 7 (read+write+execute)
            if (worldPerm !== 1 && worldPerm !== 3 && worldPerm !== 5 && worldPerm !== 7) {
                this.log('⚠️ Home directory not accessible to nginx, fixing permissions...');
                await this.executeCommand(
                    conn,
                    `sudo chmod o+x ${userHomeDir}`, // Add execute permission for others (nginx)
                    'Making home directory traversable by nginx'
                );
                this.log('✅ Home directory now accessible to nginx');
            } else {
                this.log('✅ Home directory already accessible to nginx');
            }

            // Set proper ownership (user owns files, nginx group for access)
            await this.executeCommand(
                conn,
                `sudo chown -R ${this.config.username}:${this.config.username} ${userHomeDir}/webroot/${this.domain}`,
                'Setting webroot ownership to user'
            );

            // Set proper permissions for web serving (755 allows nginx to read)
            await this.executeCommand(
                conn,
                `sudo chmod -R 755 ${userHomeDir}/webroot/${this.domain}`,
                'Setting webroot permissions for nginx access'
            );

            // Create a basic index.html file
            await this.executeCommand(
                conn,
                `cat > /tmp/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.domain}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            margin: 0;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 40px;
            backdrop-filter: blur(10px);
        }
        h1 { margin-bottom: 20px; }
        .links {
            margin-top: 30px;
        }
        .links a {
            color: #fff;
            text-decoration: none;
            padding: 10px 20px;
            border: 2px solid white;
            border-radius: 5px;
            margin: 0 10px;
            transition: all 0.3s ease;
        }
        .links a:hover {
            background: white;
            color: #667eea;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Welcome to ${this.domain}</h1>
        <p>Your Debian Development Stack is ready!</p>
        <div class="links">
            <a href="/code/">📝 VS Code Web</a>
            <a href="https://github.com/sebseb7/nodejs_installer">📚 Documentation</a>
        </div>
        <p><small>Powered by Debian Development Stack Installer v4.0.0</small></p>
    </div>
</body>
</html>
EOF`,
                'Creating welcome page'
            );

            // Move the index.html to the webroot
            await this.executeCommand(
                conn,
                `sudo mv /tmp/index.html ${userHomeDir}/webroot/${this.domain}/index.html`,
                'Installing welcome page'
            );

            this.log('✅ Webroot directory created successfully');
            this.log(`📁 Webroot: ${userHomeDir}/webroot/${this.domain}`);
            this.log(`🌐 Default page: https://${this.domain}`);

        } catch (error) {
            this.log(`❌ Webroot directory creation failed: ${error.message}`);
            throw error;
        }
    }

    async updateNginxConfig(conn, domain, path) {
        this.log(`🌐 Configuring nginx for ${domain}${path}...`);

        try {
            // Check if nginx config file already exists
            const configCheck = await this.executeCommand(
                conn,
                `sudo test -f /etc/nginx/conf.d/${domain}.conf && echo "exists" || echo "not found"`,
                'Checking if nginx config exists',
                true
            );

            let configContent = '';

            if (configCheck.output.includes('exists')) {
                this.log('📄 Found existing nginx configuration, updating it...');

                // Read existing config
                const readConfig = await this.executeCommand(
                    conn,
                    `sudo cat /etc/nginx/conf.d/${domain}.conf`,
                    'Reading existing nginx configuration',
                    true
                );

                if (readConfig.exitCode !== 0) {
                    throw new Error('Could not read existing nginx configuration');
                }

                configContent = readConfig.output;

                // Check if VS Code Web location block already exists
                if (configContent.includes(`location ${path}/ {`)) {
                    this.log(`⚠️ VS Code Web location block already exists for ${path}`);
                    return true;
                }

                // Add VS Code Web proxy location to existing HTTPS server block
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

                // Find HTTPS server block and insert proxy block
                const httpsServerPattern = /(server\s*\{[^}]*listen\s+443[^}]*\})/s;
                if (httpsServerPattern.test(configContent)) {
                    configContent = configContent.replace(
                        httpsServerPattern,
                        (match) => match.replace(/(\s*\}[^}]*$)/, `${proxyBlock}$1`)
                    );
                    this.log('✅ Added VS Code Web location to existing HTTPS server block');
                } else {
                    throw new Error('Could not find HTTPS server block in existing configuration');
                }

            } else {
                this.log('📝 Creating new nginx configuration with VS Code Web support...');

                // Create new nginx config with SSL and VS Code Web support
                configContent = `# VS Code Web configuration for ${domain}
server {
    listen 80;
    server_name ${domain};

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;

    # VS Code Web proxy location (must come before general location)
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
    }

    # Serve static files from webroot
    location / {
        root ${this.userHomeDir}/webroot/${domain};
        index index.html index.htm;
        try_files $uri $uri/ =404;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer-when-downgrade" always;
        add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    }
}`;
            }

            // Write the configuration
            await this.executeCommand(
                conn,
                `cat > /tmp/${domain}-vscode.conf << 'EOF'
${configContent}
EOF`,
                'Creating nginx configuration'
            );

            // Move to nginx directory
            await this.executeCommand(
                conn,
                `sudo mv /tmp/${domain}-vscode.conf /etc/nginx/conf.d/${domain}.conf`,
                'Installing nginx configuration'
            );

            // Test nginx configuration
            const testResult = await this.executeCommand(
                conn,
                'sudo nginx -t',
                'Testing nginx configuration'
            );

            if (testResult.exitCode !== 0) {
                this.log(`❌ Nginx configuration test failed: ${testResult.errorOutput}`);
                throw new Error('Nginx configuration test failed');
            }

            // Reload nginx
            await this.executeCommand(
                conn,
                'sudo systemctl reload nginx',
                'Reloading nginx configuration'
            );

            this.log('✅ Nginx configuration created/updated successfully');
            return true;

        } catch (error) {
            this.log(`❌ Nginx configuration failed: ${error.message}`);
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

            // Step 2: Create webroot directory
            await this.createWebrootDirectory(conn);

            // Step 3: Install code-server
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
            this.log(`🔑 Password: [PROTECTED] (hashed and stored securely)`);

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
