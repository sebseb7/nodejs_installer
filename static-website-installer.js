#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

class StaticWebsiteInstaller {
    constructor(progressCallback = null) {
        this.config = {};
        this.progressCallback = progressCallback;
        this.domain = null;
        this.zipFilePath = null;
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

    setWebsiteConfig(domain, zipFilePath) {
        this.domain = domain;
        this.zipFilePath = zipFilePath;
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
        this.log('🔍 Checking if Nginx is installed...');

        try {
            // First check if nginx command is available
            const commandCheck = await this.executeCommand(
                conn,
                'command -v nginx >/dev/null 2>&1',
                'Checking if nginx command is available',
                true
            );

            if (commandCheck.exitCode === 0) {
                // Nginx command found, now get version
                const versionCheck = await this.executeCommand(
                    conn,
                    'nginx -v 2>&1 | head -1',
                    'Getting nginx version',
                    true
                );

                if (versionCheck.exitCode === 0) {
                    const nginxVersion = versionCheck.output.trim();
                    this.log(`✅ Nginx is installed: ${nginxVersion}`);
                    return { installed: true, version: nginxVersion };
                }
            }

            // If command -v fails, try checking common nginx binary locations
            this.log('⚠️ Nginx command not found in PATH, checking common locations...');

            const binaryCheck = await this.executeCommand(
                conn,
                'ls -la /usr/sbin/nginx /usr/bin/nginx /usr/local/bin/nginx /usr/local/sbin/nginx 2>/dev/null | head -1',
                'Checking nginx binary locations',
                true
            );

            if (binaryCheck.exitCode === 0 && binaryCheck.output.trim()) {
                // Try to get version from the found binary
                const binaryPath = binaryCheck.output.split(' ').pop();
                const versionCheck = await this.executeCommand(
                    conn,
                    `${binaryPath} -v 2>&1 | head -1`,
                    'Getting nginx version from binary',
                    true
                );

                if (versionCheck.exitCode === 0) {
                    const nginxVersion = versionCheck.output.trim();
                    this.log(`✅ Nginx is installed: ${nginxVersion}`);
                    return { installed: true, version: nginxVersion };
                }
            }

            // Final fallback: check if nginx service is running
            const serviceCheck = await this.executeCommand(
                conn,
                'systemctl is-active nginx 2>/dev/null || service nginx status 2>/dev/null || /etc/init.d/nginx status 2>/dev/null',
                'Checking if nginx service is running',
                true
            );

            if (serviceCheck.exitCode === 0) {
                this.log('✅ Nginx service is running (binary may not be in PATH)');
                return { installed: true, version: 'Unknown (service running)' };
            }

            this.log('❌ Nginx is not installed or not accessible');
            return { installed: false };
        } catch (error) {
            this.log(`❌ Error checking Nginx installation: ${error.message}`);
            return { installed: false };
        }
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
                this.log(`ℹ️ SSL certificate not found for ${domain}`);
                return { hasSSL: false };
            }
        } catch (error) {
            this.log(`❌ Error checking SSL status: ${error.message}`);
            return { hasSSL: false };
        }
    }

    async cleanExistingInstallation(conn) {
        if (!this.domain) {
            throw new Error('Domain is required for cleaning existing installation');
        }

        this.log('🧹 Cleaning existing installation...');

        try {
            // Remove existing nginx config (only the .conf file we created)
            await this.executeCommand(
                conn,
                `sudo rm -f /etc/nginx/conf.d/${this.domain}.conf`,
                'Removing existing nginx configuration'
            );

            // Remove existing webroot directory
            await this.executeCommand(
                conn,
                `sudo rm -rf /opt/webroot/${this.domain}`,
                'Removing existing webroot directory'
            );

            this.log('✅ Existing installation cleaned successfully');
        } catch (error) {
            // Don't fail if cleanup doesn't work (might not exist)
            this.log('⚠️ Cleanup completed with warnings (some files may not have existed)');
        }
    }

    async uploadZipFile(conn) {
        if (!this.zipFilePath || !fs.existsSync(this.zipFilePath)) {
            throw new Error('ZIP file path is invalid or file does not exist');
        }

        this.log('📤 Uploading ZIP file to server...');

        return new Promise((resolve, reject) => {
            const zipFileName = path.basename(this.zipFilePath);
            const remotePath = `/tmp/${zipFileName}`;

            conn.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                const readStream = fs.createReadStream(this.zipFilePath);
                const writeStream = sftp.createWriteStream(remotePath);

                writeStream.on('close', () => {
                    this.log('✅ ZIP file uploaded successfully');
                    sftp.end();
                    resolve(remotePath);
                });

                writeStream.on('error', (err) => {
                    this.log(`❌ ZIP file upload failed: ${err.message}`);
                    sftp.end();
                    reject(err);
                });

                readStream.pipe(writeStream);
            });
        });
    }

    async extractZipFile(conn, remoteZipPath) {
        if (!this.domain) {
            throw new Error('Domain is required for extraction');
        }

        this.log('📦 Extracting ZIP file to webroot...');

        try {
            // Ensure /opt/webroot directory exists and has correct permissions
            await this.executeCommand(
                conn,
                `sudo mkdir -p /opt/webroot`,
                'Ensuring webroot parent directory exists'
            );

            // Set permissions on /opt/webroot to allow nginx traversal
            await this.executeCommand(
                conn,
                `sudo chmod 755 /opt/webroot`,
                'Setting webroot parent directory permissions'
            );

            // Create domain-specific webroot directory
            await this.executeCommand(
                conn,
                `sudo mkdir -p /opt/webroot/${this.domain}`,
                'Creating webroot directory'
            );

            // Extract ZIP file to webroot
            await this.executeCommand(
                conn,
                `sudo unzip -o ${remoteZipPath} -d /opt/webroot/${this.domain}`,
                'Extracting ZIP file to webroot'
            );

            // Use the nginx user (we know this because we installed nginx)
            const webUser = "nginx";
            this.log(`🌐 Using web server user: ${webUser}`);

            // Set proper ownership for the domain directory
            await this.executeCommand(
                conn,
                `sudo chown -R ${webUser}:${webUser} /opt/webroot/${this.domain}`,
                `Setting webroot ownership to ${webUser}`
            );

            // Set proper permissions for web serving
            // 755 is sufficient for both files and directories for nginx to serve content
            await this.executeCommand(
                conn,
                `sudo chmod -R 755 /opt/webroot/${this.domain}`,
                'Setting webroot permissions for nginx access'
            );

            // Verify the webroot setup and file permissions
            await this.executeCommand(
                conn,
                `sudo ls -la /opt/webroot/${this.domain}/`,
                'Checking webroot directory contents',
                true
            );

            await this.executeCommand(
                conn,
                `sudo ls -la /opt/webroot/${this.domain}/index.html 2>/dev/null || echo "Index file not found"`,
                'Verifying index file exists',
                true
            );

            // Check if nginx can access the directory
            await this.executeCommand(
                conn,
                `sudo -u ${webUser} ls /opt/webroot/${this.domain}/index.html 2>/dev/null || echo "Web server user cannot access index file"`,
                `Testing ${webUser} access to index file`,
                true
            );

            // Check if SELinux might be blocking access
            const selinuxCheck = await this.executeCommand(
                conn,
                `command -v getenforce >/dev/null 2>&1 && getenforce || echo "no-selinux"`,
                'Checking SELinux status',
                true
            );

            if (!selinuxCheck.output.includes("no-selinux")) {
                this.log(`ℹ️ SELinux status: ${selinuxCheck.output.trim()}`);
                if (selinuxCheck.output.includes("Enforcing")) {
                    this.log('⚠️ SELinux is enforcing - this might restrict nginx access to /opt/webroot');
                }
            }

            // Check nginx configuration directory structure
            const listConfigs = await this.executeCommand(
                conn,
                'sudo find /etc/nginx -name "*.conf" -type f | head -10',
                'Finding all nginx configuration files',
                true
            );

            this.log('📋 Nginx configuration files found:');
            this.log(listConfigs.output);

            // Check if our config file exists and is readable
            const checkOurConfig = await this.executeCommand(
                conn,
                `sudo ls -la /etc/nginx/conf.d/${this.domain}.conf`,
                'Checking our nginx configuration file',
                true
            );

            if (checkOurConfig.exitCode !== 0) {
                this.log('❌ Our nginx configuration file was not created!');
            }

            // Check if conf.d is included in main nginx.conf
            const checkInclude = await this.executeCommand(
                conn,
                `sudo grep -n "conf.d" /etc/nginx/nginx.conf || echo "conf.d not included in nginx.conf"`,
                'Checking if conf.d is included in main nginx configuration',
                true
            );

            if (checkInclude.output.includes("conf.d not included")) {
                this.log('⚠️ conf.d directory may not be included in nginx.conf');
                this.log('📝 This could prevent our configuration from being loaded');
            } else {
                this.log('✅ conf.d directory is included in nginx.conf');
            }

            // Test nginx configuration syntax
            const testConfig = await this.executeCommand(
                conn,
                'sudo nginx -t 2>&1',
                'Testing nginx configuration syntax',
                true
            );

            if (testConfig.exitCode !== 0) {
                this.log(`❌ Nginx configuration test failed:`);
                this.log(testConfig.output);
            } else {
                this.log('✅ Nginx configuration syntax is valid');

                // Reload nginx
                const reloadResult = await this.executeCommand(
                    conn,
                    'sudo systemctl reload nginx 2>&1 || sudo service nginx reload 2>&1',
                    'Reloading nginx configuration',
                    true
                );

                if (reloadResult.exitCode !== 0) {
                    this.log(`❌ Failed to reload nginx:`);
                    this.log(reloadResult.output);
                } else {
                    this.log('✅ Nginx configuration reloaded successfully');
                }
            }

            // Check nginx error logs for our domain
            const checkLogs = await this.executeCommand(
                conn,
                'sudo tail -10 /var/log/nginx/error.log 2>/dev/null || echo "No nginx error logs found"',
                'Checking recent nginx error logs',
                true
            );

            this.log('📋 Recent nginx error logs:');
            this.log(checkLogs.output);

            // Clean up uploaded ZIP file
            await this.executeCommand(
                conn,
                `sudo rm -f ${remoteZipPath}`,
                'Cleaning up uploaded ZIP file'
            );

            this.log('✅ ZIP file extracted successfully');
        } catch (error) {
            this.log(`❌ ZIP extraction failed: ${error.message}`);
            throw error;
        }
    }

    async createNginxConfig(conn, hasSSL = false) {
        if (!this.domain) {
            throw new Error('Domain is required for nginx configuration');
        }

        this.log('⚙️ Creating nginx configuration...');

        try {
            let nginxConfig = `# Static website configuration for ${this.domain}
server {
    listen 80;
    server_name ${this.domain};

    root /opt/webroot/${this.domain};
    index index.html index.htm;${hasSSL ? `

    # Redirect all HTTP traffic to HTTPS (except ACME challenges)
    location / {
        return 301 https://$server_name$request_uri;
    }` : `

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/xml+rss
        application/json;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Handle static files
    location / {
        try_files $uri $uri/ =404;
    }`}

    # ACME challenge for SSL renewal (always keep this)
    location /.well-known/acme-challenge/ {
        alias /usr/share/nginx/html/.well-known/acme-challenge/;
        try_files $uri =404;
    }
}`;

            // Add SSL configuration if SSL certificate exists
            if (hasSSL) {
                nginxConfig += `

server {
    listen 443 ssl http2;
    server_name ${this.domain};

    root /opt/webroot/${this.domain};
    index index.html index.htm;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/${this.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${this.domain}/privkey.pem;

    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/xml+rss
        application/json;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Handle static files
    location / {
        try_files $uri $uri/ =404;
    }

    # ACME challenge for SSL renewal (always keep this)
    location /.well-known/acme-challenge/ {
        alias /usr/share/nginx/html/.well-known/acme-challenge/;
        try_files $uri =404;
    }
}`;
            }

            // Write nginx configuration
            await this.executeCommand(
                conn,
                `cat > /tmp/${this.domain}.conf << 'EOF'
${nginxConfig}
EOF`,
                'Creating nginx configuration file'
            );

            // Move to nginx sites directory and set proper ownership
            await this.executeCommand(
                conn,
                `sudo mv /tmp/${this.domain}.conf /etc/nginx/conf.d/${this.domain}.conf && sudo chown root:root /etc/nginx/conf.d/${this.domain}.conf && sudo chmod 644 /etc/nginx/conf.d/${this.domain}.conf`,
                'Moving nginx configuration to sites directory with proper ownership'
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

            if (hasSSL) {
                this.log('✅ Nginx configuration created with SSL support');
            } else {
                this.log('✅ Nginx configuration created (HTTP only)');
            }

        } catch (error) {
            this.log(`❌ Nginx configuration failed: ${error.message}`);
            throw error;
        }
    }

    async installStaticWebsite(conn) {
        if (!this.domain || !this.zipFilePath) {
            throw new Error('Domain and ZIP file path are required');
        }

        this.log('🚀 Starting static website installation...');

        try {
            // Step 1: Check if Nginx is installed
            const nginxCheck = await this.checkNginxInstalled(conn);
            if (!nginxCheck.installed) {
                throw new Error('Nginx is not installed. Please install Nginx first.');
            }

            // Step 2: Check SSL status
            const sslStatus = await this.checkSSLStatus(conn, this.domain);
            const hasSSL = sslStatus.hasSSL;

            if (hasSSL) {
                this.log('🔒 SSL certificate detected - will configure HTTPS support');
            } else {
                this.log('ℹ️ No SSL certificate found - configuring HTTP only');
            }

            // Step 3: Clean existing installation
            await this.cleanExistingInstallation(conn);

            // Step 4: Upload ZIP file
            const remoteZipPath = await this.uploadZipFile(conn);

            // Step 5: Extract ZIP file
            await this.extractZipFile(conn, remoteZipPath);

            // Step 6: Create nginx configuration
            await this.createNginxConfig(conn, hasSSL);

            this.log('🎉 Static website installation completed successfully!');
            this.log(`📋 Domain: ${this.domain}`);
            this.log(`📁 Webroot: /opt/webroot/${this.domain}`);
            this.log(`⚙️ Nginx config: /etc/nginx/conf.d/${this.domain}.conf`);
            if (hasSSL) {
                this.log('🔒 SSL: Enabled (HTTPS available)');
            } else {
                this.log('🔓 SSL: Not configured (HTTP only)');
            }

            return {
                success: true,
                domain: this.domain,
                webroot: `/opt/webroot/${this.domain}`,
                nginxConfig: `/etc/nginx/conf.d/${this.domain}.conf`,
                hasSSL: hasSSL
            };

        } catch (error) {
            this.log(`❌ Static website installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installStaticWebsite(conn);

            if (result.success) {
                this.log('✅ Static website setup completed successfully!');
            }
        } catch (error) {
            this.log(`❌ Setup failed: ${error.message}`);
            process.exit(1);
        } finally {
            if (conn) {
                conn.end();
            }
        }
    }
}

// Run the installer if this file is executed directly
if (require.main === module) {
    const installer = new StaticWebsiteInstaller();
    installer.run().catch(console.error);
}

module.exports = StaticWebsiteInstaller;
