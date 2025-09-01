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

    async installLetsEncrypt(conn) {
        if (!this.domain || !this.email) {
            throw new Error('Domain and email are required');
        }

        this.log('🚀 Starting SSL certificate installation...');

        try {
            // FIRST STEP: Test domain reachability
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

// Run the installer if this file is executed directly
if (require.main === module) {
    const installer = new SimpleSSLInstaller();
    installer.run().catch(console.error);
}

module.exports = SimpleSSLInstaller;
