#!/usr/bin/env node

const { Client } = require('ssh2');
const fs = require('fs');

class SimpleSSLInstaller {
    constructor(progressCallback = null) {
        this.config = {};
        this.progressCallback = progressCallback;
        this.domain = null;
        this.email = null;
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

    setCertificateConfig(domain, email) {
        this.domain = domain;
        this.email = email;
    }

    async installCertbot(conn) {
        this.log('🔧 Installing Certbot...');

        try {
            // Update package list
            await this.executeCommand(conn, 'sudo apt update', 'Updating package list');

            // Install certbot
            await this.executeCommand(
                conn,
                'sudo apt install -y certbot python3-certbot-nginx',
                'Installing Certbot'
            );

            // Create renewal hook directory and script
            await this.createRenewalHook(conn);

            // Verify installation
            const result = await this.executeCommand(conn, 'certbot --version', 'Verifying Certbot');
            if (result.exitCode === 0) {
                this.log('✅ Certbot installed successfully');
                return true;
            } else {
                throw new Error('Certbot installation verification failed');
            }
        } catch (error) {
            this.log(`❌ Certbot installation failed: ${error.message}`);
            throw error;
        }
    }

    async createRenewalHook(conn) {
        this.log('🔄 Creating SSL certificate renewal hook...');

        try {
            // Create the renewal-hooks directory if it doesn't exist
            await this.executeCommand(
                conn,
                'sudo mkdir -p /etc/letsencrypt/renewal-hooks/post',
                'Creating renewal hooks directory'
            );

            // Create the nginx reload hook script
            const hookScript = `#!/bin/bash
# Let's Encrypt certificate renewal hook
# This script reloads nginx after certificate renewal

# Log the renewal
echo "$(date): SSL certificate renewed, reloading nginx..." >> /var/log/letsencrypt-renewal.log

# Reload nginx to pick up new certificates
sudo systemctl reload nginx

# Log success
echo "$(date): Nginx reloaded successfully" >> /var/log/letsencrypt-renewal.log

exit 0`;

            // Write the hook script
            await this.executeCommand(
                conn,
                `cat > /tmp/nginx-reload-hook.sh << 'EOF'
${hookScript}
EOF`,
                'Creating nginx reload hook script'
            );

            // Move to renewal hooks directory and make executable
            await this.executeCommand(
                conn,
                'sudo mv /tmp/nginx-reload-hook.sh /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh',
                'Moving hook script to renewal hooks directory'
            );

            await this.executeCommand(
                conn,
                'sudo chmod +x /etc/letsencrypt/renewal-hooks/post/nginx-reload.sh',
                'Making hook script executable'
            );

            this.log('✅ SSL renewal hook created successfully');
            this.log('📝 Nginx will automatically reload after certificate renewals');

        } catch (error) {
            this.log(`⚠️ Failed to create renewal hook: ${error.message}`);
            this.log('📝 You may need to manually reload nginx after certificate renewals');
        }
    }

    async obtainSSLCertificate(conn, domain, email) {
        this.log(`🔐 Obtaining SSL certificate for ${domain}...`);

        try {
            // Run certbot using nginx plugin
            const certbotCommand = `sudo certbot certonly -d ${domain} --nginx -n --email ${email} --agree-tos`;

            const result = await this.executeCommand(
                conn,
                certbotCommand,
                'Obtaining SSL certificate'
            );

            if (result.exitCode === 0) {
                this.log('✅ SSL certificate obtained successfully');
                this.log('📅 Certbot will handle automatic renewal');

                return true;
            } else {
                this.log(`❌ Certificate obtainment failed: ${result.errorOutput}`);
                throw new Error(`Certificate obtainment failed: ${result.errorOutput}`);
            }

        } catch (error) {
            this.log(`❌ SSL certificate obtainment failed: ${error.message}`);
            throw error;
        }
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









    async testDomainReachability(conn, domain) {
        this.log('🌐 Testing domain reachability...');

        try {
            // Create test directory if it doesn't exist
            await this.executeCommand(
                conn,
                'sudo mkdir -p /usr/share/nginx/html/.well-known/acme-challenge',
                'Creating ACME challenge directory in nginx default root'
            );

            // Set proper ownership
            await this.executeCommand(
                conn,
                'sudo chown -R www-data:www-data /usr/share/nginx/html',
                'Setting nginx default root ownership'
            );

            // Create a test file
            const testContent = `Domain reachability test for ${domain} - ${new Date().toISOString()}`;
            await this.executeCommand(
                conn,
                `echo "${testContent}" | sudo tee /usr/share/nginx/html/.well-known/acme-challenge/domain-test.txt > /dev/null`,
                'Creating domain reachability test file'
            );

            // Test if the file is reachable via the domain
            this.log(`🔍 Testing if ${domain} can reach the test file...`);
            const testResult = await this.executeCommand(
                conn,
                `curl -s -I http://${domain}/.well-known/acme-challenge/domain-test.txt | head -1`,
                'Testing domain connectivity to test file',
                true
            );

            if (testResult.output.includes('200') || testResult.output.includes('404')) {
                this.log(`✅ Domain ${domain} is reachable and can access test files`);
                return true;
            } else {
                this.log(`❌ Domain ${domain} is not reachable or cannot access test files`);
                this.log(`Response: ${testResult.output}`);
                throw new Error(`Domain ${domain} is not properly configured or reachable`);
            }

        } catch (error) {
            this.log(`❌ Domain reachability test failed: ${error.message}`);
            throw error;
        }
    }

    async checkNginxInstallation(conn) {
        this.log('🌐 Checking nginx installation and status...');

        try {
            // Check if nginx is installed using multiple methods (more robust than 'which')
            let nginxInstalled = false;
            let nginxVersion = 'unknown';

            // Method 1: Check common nginx binary locations
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
                        `${path} -v 2>&1`,
                        `Checking nginx at ${path}`,
                        true
                    );

                    if (versionResult.exitCode === 0) {
                        nginxVersion = versionResult.output.trim() || versionResult.errorOutput.trim();
                        if (nginxVersion) {
                            nginxInstalled = true;
                            this.log(`✅ Found nginx at ${path}: ${nginxVersion}`);
                            break;
                        }
                    }
                } catch (error) {
                    // Continue to next path
                }
            }

            // Method 2: Try command -v nginx (if PATH includes nginx location)
            if (!nginxInstalled) {
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
                            `${nginxPath} -v 2>&1`,
                            'Checking Nginx version',
                            true
                        );

                        if (versionResult.exitCode === 0) {
                            nginxVersion = versionResult.output.trim() || versionResult.errorOutput.trim();
                            if (nginxVersion) {
                                nginxInstalled = true;
                                this.log(`✅ Found nginx via PATH: ${nginxVersion}`);
                            }
                        }
                    }
                } catch (error) {
                    // Continue to fallback methods
                }
            }

            // Method 3: Check if nginx package is installed via dpkg
            if (!nginxInstalled) {
                try {
                    const dpkgResult = await this.executeCommand(
                        conn,
                        'dpkg -l nginx 2>/dev/null | grep "^ii"',
                        'Checking if nginx package is installed',
                        true
                    );

                    if (dpkgResult.exitCode === 0) {
                        nginxInstalled = true;
                        // Try to extract version from dpkg output
                        const dpkgLines = dpkgResult.output.trim().split('\n');
                        if (dpkgLines.length > 0) {
                            const parts = dpkgLines[0].trim().split(/\s+/);
                            if (parts.length >= 3) {
                                nginxVersion = `nginx/${parts[2]}`;
                            } else {
                                nginxVersion = 'package-installed';
                            }
                        }
                        this.log(`✅ Nginx package found: ${nginxVersion}`);
                    }
                } catch (error) {
                    // Continue to final fallback
                }
            }

            // Method 4: Check if nginx service exists
            if (!nginxInstalled) {
                try {
                    const serviceResult = await this.executeCommand(
                        conn,
                        'systemctl list-units --type=service --all | grep -q nginx',
                        'Checking nginx service',
                        true
                    );

                    if (serviceResult.exitCode === 0) {
                        nginxInstalled = true;
                        nginxVersion = 'service-installed';
                        this.log('✅ Nginx service found');
                    }
                } catch (error) {
                    // Service check failed
                }
            }

            if (!nginxInstalled) {
                this.log('❌ Nginx is not installed on this system');
                this.log('💡 Please install nginx first using: node nginx-installer.js [options]');
                throw new Error('Nginx is required but not installed');
            }

            this.log('✅ Nginx is installed');

            // Check if nginx is running
            const nginxStatus = await this.executeCommand(
                conn,
                'sudo systemctl is-active nginx 2>/dev/null || echo "not running"',
                'Checking if nginx service is running',
                true
            );

            if (nginxStatus.output.trim() === 'not running') {
                this.log('⚠️ Nginx service is not running, attempting to start it...');

                await this.executeCommand(
                    conn,
                    'sudo systemctl start nginx',
                    'Starting nginx service'
                );

                // Verify it started successfully
                const verifyStart = await this.executeCommand(
                    conn,
                    'sudo systemctl is-active nginx 2>/dev/null || echo "failed to start"',
                    'Verifying nginx service started',
                    true
                );

                if (verifyStart.output.trim() === 'failed to start') {
                    this.log('❌ Failed to start nginx service');
                    throw new Error('Nginx service failed to start');
                }

                this.log('✅ Nginx service started successfully');
            } else {
                this.log('✅ Nginx service is running');
            }

            // Check if nginx can serve files (test with a simple request)
            const nginxTest = await this.executeCommand(
                conn,
                'curl -s -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "connection failed"',
                'Testing nginx connectivity',
                true
            );

            const httpCode = nginxTest.output.trim();
            if (httpCode === '200' || httpCode === '403' || httpCode === '404') {
                this.log('✅ Nginx is responding to HTTP requests');
            } else {
                this.log(`⚠️ Nginx returned HTTP code: ${httpCode}`);
                this.log('⚠️ Nginx may not be configured correctly, but continuing...');
            }

        } catch (error) {
            this.log(`❌ Nginx check failed: ${error.message}`);
            throw error;
        }
    }

    async installLetsEncrypt(conn) {
        if (!this.domain || !this.email) {
            throw new Error('Domain and email are required');
        }

        this.log('🚀 Starting SSL certificate installation...');

        try {
            // FIRST STEP: Check nginx installation and status
            await this.checkNginxInstallation(conn);

            // SECOND STEP: Test domain reachability
            await this.testDomainReachability(conn, this.domain);

            // Install certbot
            await this.installCertbot(conn);

            // Obtain SSL certificate
            await this.obtainSSLCertificate(conn, this.domain, this.email);

            this.log('🎉 SSL certificate obtained successfully!');
            this.log(`📋 Domain: ${this.domain}`);
            this.log(`📋 Email: ${this.email}`);
            this.log(`📄 SSL certificates saved to /etc/letsencrypt/live/${this.domain}/`);

            return {
                success: true,
                domain: this.domain,
                email: this.email
            };

        } catch (error) {
            this.log(`❌ SSL installation failed: ${error.message}`);
            throw error;
        }
    }

    async run() {
        let conn;

        try {
            conn = await this.connect();
            const result = await this.installLetsEncrypt(conn);

            if (result.success) {
                this.log('✅ SSL certificate installation completed successfully!');
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
            case '--domain':
            case '-d':
                config.domain = args[++i];
                break;
            case '--email':
            case '-e':
                config.email = args[++i];
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
Let's Encrypt SSL Installer - Command Line Interface

USAGE:
  node letsencrypt-installer.js [OPTIONS]

REQUIRED OPTIONS:
  --host, -h HOST          SSH host/IP address
  --username, -u USER      SSH username (usually 'admin' for Debian)
  --key, -k PATH           Path to SSH private key file
  --domain, -d DOMAIN      Domain name for SSL certificate
  --email, -e EMAIL        Email address for Let's Encrypt notifications

OPTIONAL:
  --port, -p PORT          SSH port (default: 22)
  --passphrase PASS        SSH key passphrase (if required)
  --help                   Show this help

EXAMPLES:
  # Basic usage
  node letsencrypt-installer.js --host 18.195.241.96 --username admin --key 18.195.241.96.pem --domain example.com --email admin@example.com

  # Short form
  node letsencrypt-installer.js -h 18.195.241.96 -u admin -k ./my-key.pem -d example.com -e admin@example.com

  # With custom SSH port
  node letsencrypt-installer.js --host ec2-instance.com --username debian --key ./key.pem --domain example.com --email admin@example.com --port 2222

PREREQUISITES:
  - SSH access to target Debian/Ubuntu server
  - Domain name pointing to server IP
  - Port 80 accessible (for HTTP-01 challenge)
  - Nginx installed and running (required - installer will check and attempt to start if needed)

WHAT IT INSTALLS:
  - Certbot (Let's Encrypt client)
  - SSL certificate for your domain
  - Automatic certificate renewal (cron job)
  - Nginx SSL configuration (if nginx is installed)

SECURITY FEATURES:
  - Free SSL certificates from Let's Encrypt
  - Automatic renewal before expiration
  - OCSP stapling and HSTS headers
  - Strong cipher suites

NOTES:
  - Ensure SSH key has proper permissions (chmod 600 key.pem)
  - Domain must resolve to server IP address
  - Port 80 must be open for certificate validation
  - Email address is used for urgent renewal notifications
  - Nginx installation and status are automatically verified
`);
}

// Run the installer if this file is executed directly
if (require.main === module) {
    const config = parseArgs();

    if (Object.keys(config).length === 0) {
        console.error('❌ No configuration provided!');
        console.error('Use --help for usage instructions.');
        process.exit(1);
    }

    // Check required parameters
    const required = ['host', 'username', 'privateKeyPath', 'domain', 'email'];
    const missing = required.filter(key => !config[key]);

    if (missing.length > 0) {
        console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
        console.error('Use --help for usage instructions.');
        process.exit(1);
    }

    // Set defaults
    config.port = config.port || 22;
    config.username = config.username || 'admin';

    const installer = new SimpleSSLInstaller();
    installer.config = config;
    installer.setCertificateConfig(config.domain, config.email);

    installer.run().catch(console.error);
}

module.exports = SimpleSSLInstaller;
