#!/usr/bin/env node

/**
 * Debian Development Stack Installer - Command Line Interface
 *
 * Master CLI that provides access to all installers with unified interface
 */

const path = require('path');

// Import all installers
const AWSInstanceCreator = require('./createInstanceScripts/create-aws-instance');
const BasicToolsInstaller = require('./basic-tools-installer');
const NodeJSInstaller = require('./index');
const NginxInstaller = require('./nginx-installer');
const SSLInstaller = require('./letsencrypt-installer');
const VSCodeWebInstaller = require('./vscode-web-installer');

function showMasterHelp() {
    console.log(`
🚀 Debian Development Stack Installer - CLI

A complete suite of command-line tools for setting up development environments on Debian servers.

AVAILABLE INSTALLERS:

1. 🌐 AWS Instance Creator
   node installer-cli.js aws [OPTIONS]
   node createInstanceScripts/create-aws-instance.js [OPTIONS]

2. 🔧 Basic Tools Installer
   node installer-cli.js tools [OPTIONS]
   node basic-tools-installer.js [OPTIONS]

3. 🟢 Node.js Installer
   node installer-cli.js node [OPTIONS]
   node index.js [OPTIONS]

4. 🌐 Nginx Installer
   node installer-cli.js nginx [OPTIONS]
   node nginx-installer.js [OPTIONS]

5. 🔒 SSL Certificate Installer (Let's Encrypt)
   node installer-cli.js ssl [OPTIONS]
   node letsencrypt-installer.js [OPTIONS]

6. 📝 VS Code Web Installer
   node installer-cli.js vscode [OPTIONS]
   node vscode-web-installer.js [OPTIONS]

7. 🧹 AWS Resource Cleanup
   node installer-cli.js cleanup [OPTIONS]
   node createInstanceScripts/create-aws-instance.js --cleanup [OPTIONS]

COMMON SSH OPTIONS (for most installers):
  --host, -h HOST          SSH host/IP address
  --username, -u USER      SSH username (usually 'admin')
  --key, -k PATH           Path to SSH private key file
  --port, -p PORT          SSH port (default: 22)
  --passphrase PASS        SSH key passphrase (if required)

EXAMPLES:

# Complete setup workflow:
# 1. Create AWS instance
node installer-cli.js aws

# 2. Install basic tools
node installer-cli.js tools --host 18.195.241.96 --username admin --key 18.195.241.96.pem

# 3. Install Node.js
node installer-cli.js node --host 18.195.241.96 --username admin --key 18.195.241.96.pem

# 4. Install Nginx
node installer-cli.js nginx --host 18.195.241.96 --username admin --key 18.195.241.96.pem

# 5. Install SSL certificate
node installer-cli.js ssl --host 18.195.241.96 --username admin --key 18.195.241.96.pem --domain example.com --email admin@example.com

# 6. Install VS Code Web
node installer-cli.js vscode --host 18.195.241.96 --username admin --key 18.195.241.96.pem --domain example.com --password mySecretPassword

# 7. Clean up when done
node installer-cli.js cleanup

SHORTCUTS:
  node installer-cli.js help     # Show this help
  node installer-cli.js --help   # Show this help
  node installer-cli.js h        # Show this help

INDIVIDUAL INSTALLER HELP:
  node [installer-file].js --help  # Get specific help for each installer

NOTES:
  - All installers support --help for detailed usage
  - SSH keys should have proper permissions (chmod 600 key.pem)
  - Some installers have additional prerequisites (SSL certs, domains, etc.)
  - AWS instance creator requires AWS credentials in .env file
`);
}

function showAWSHelp() {
    console.log(`
🌐 AWS Instance Creator Help:

Creates a t3.small Debian 13 Trixie instance in eu-central-1 with HTTP/HTTPS enabled.

USAGE:
  node installer-cli.js aws
  node createInstanceScripts/create-aws-instance.js

This command will:
- Create a fresh SSH keypair (named after instance IP)
- Set up security group with HTTP/HTTPS ports open
- Launch t3.small Debian 13 instance
- Save private key as {instance-ip}.pem

PREREQUISITES:
- AWS credentials configured in .env file
- IAM user with EC2 permissions (see ec2-minimal-policy.json)

CLEANUP:
  node installer-cli.js cleanup
  # Removes instances, security groups, and keypairs
`);
}

function showToolsHelp() {
    console.log(`
🔧 Basic Tools Installer Help:

Installs essential development tools on Debian/Ubuntu servers.

USAGE:
  node installer-cli.js tools --host HOST --username USER --key KEY_FILE
  node basic-tools-installer.js --host HOST --username USER --key KEY_FILE

TOOLS INSTALLED:
- git, htop, ripgrep, build-essential
- curl, wget, vim, mc, unzip

EXAMPLE:
  node installer-cli.js tools --host 18.195.241.96 --username admin --key 18.195.241.96.pem
`);
}

function showNodeHelp() {
    console.log(`
🟢 Node.js Installer Help:

Installs Node.js LTS and npm on Debian/Ubuntu servers.

USAGE:
  node installer-cli.js node --host HOST --username USER --key KEY_FILE
  node index.js --host HOST --username USER --key KEY_FILE

WHAT IT INSTALLS:
- Node.js LTS from NodeSource repository
- npm (Node Package Manager)
- Development tools

EXAMPLE:
  node installer-cli.js node --host 18.195.241.96 --username admin --key 18.195.241.96.pem
`);
}

function showNginxHelp() {
    console.log(`
🌐 Nginx Installer Help:

Installs and configures Nginx web server.

USAGE:
  node installer-cli.js nginx --host HOST --username USER --key KEY_FILE
  node nginx-installer.js --host HOST --username USER --key KEY_FILE

WHAT IT INSTALLS:
- Nginx web server
- Security configuration
- Auto-start configuration

EXAMPLE:
  node installer-cli.js nginx --host 18.195.241.96 --username admin --key 18.195.241.96.pem
`);
}

function showSSLHelp() {
    console.log(`
🔒 SSL Certificate Installer Help:

Installs free SSL certificates from Let's Encrypt.

USAGE:
  node installer-cli.js ssl --host HOST --username USER --key KEY_FILE --domain DOMAIN --email EMAIL
  node letsencrypt-installer.js --host HOST --username USER --key KEY_FILE --domain DOMAIN --email EMAIL

PREREQUISITES:
- Domain pointing to server IP
- Port 80 accessible
- Nginx installed (recommended)

EXAMPLE:
  node installer-cli.js ssl --host 18.195.241.96 --username admin --key 18.195.241.96.pem --domain example.com --email admin@example.com
`);
}

function showVSCodeHelp() {
    console.log(`
📝 VS Code Web Installer Help:

Installs VS Code Web (code-server) with nginx proxy.

USAGE:
  node installer-cli.js vscode --host HOST --username USER --key KEY_FILE --domain DOMAIN --password PASSWORD
  node vscode-web-installer.js --host HOST --username USER --key KEY_FILE --domain DOMAIN --password PASSWORD

PREREQUISITES:
- SSL certificate installed for domain
- Nginx installed and running

ACCESS AFTER INSTALLATION:
- URL: https://your-domain.com/code
- Password: The password you specified

EXAMPLE:
  node installer-cli.js vscode --host 18.195.241.96 --username admin --key 18.195.241.96.pem --domain example.com --password mySecretPassword
`);
}

function showCleanupHelp() {
    console.log(`
🧹 AWS Resource Cleanup Help:

Removes AWS resources created by the instance creator.

USAGE:
  node installer-cli.js cleanup [OPTIONS]
  node createInstanceScripts/create-aws-instance.js --cleanup [OPTIONS]

OPTIONS:
  --instance ID        Clean up specific instance
  --keypair NAME       Clean up specific keypair
  --security-group ID  Clean up specific security group
  --yes, -y           Skip confirmation prompts

EXAMPLES:
  # Auto-discover and clean up all resources
  node installer-cli.js cleanup

  # Clean up specific instance
  node installer-cli.js cleanup --instance i-1234567890abcdef0 --yes

  # Clean up specific keypair
  node installer-cli.js cleanup --keypair debian-trixie-2025-09-02T07-25-12 --yes
`);
}

// Main CLI logic
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('help') || args.includes('h')) {
    showMasterHelp();
    process.exit(0);
}

const command = args[0];

switch (command) {
    case 'aws':
        // Run AWS instance creator
        const awsCreator = new AWSInstanceCreator();
        awsCreator.run().catch(console.error);
        break;

    case 'tools':
        // Show tools help if no additional args
        if (args.length === 1) {
            showToolsHelp();
        } else {
            // Parse SSH args and run basic tools installer
            const config = parseSSHArgs(args.slice(1));
            if (!config.host || !config.username || !config.privateKeyPath) {
                showToolsHelp();
                process.exit(1);
            }
            const toolsInstaller = new BasicToolsInstaller();
            toolsInstaller.config = config;
            toolsInstaller.run().catch(console.error);
        }
        break;

    case 'node':
        // Show node help if no additional args
        if (args.length === 1) {
            showNodeHelp();
        } else {
            // Parse SSH args and run node installer
            const config = parseSSHArgs(args.slice(1));
            if (!config.host || !config.username || !config.privateKeyPath) {
                showNodeHelp();
                process.exit(1);
            }
            const nodeInstaller = new NodeJSInstaller();
            nodeInstaller.config = config;
            nodeInstaller.run().catch(console.error);
        }
        break;

    case 'nginx':
        // Show nginx help if no additional args
        if (args.length === 1) {
            showNginxHelp();
        } else {
            // Parse SSH args and run nginx installer
            const config = parseSSHArgs(args.slice(1));
            if (!config.host || !config.username || !config.privateKeyPath) {
                showNginxHelp();
                process.exit(1);
            }
            const nginxInstaller = new NginxInstaller();
            nginxInstaller.config = config;
            nginxInstaller.run().catch(console.error);
        }
        break;

    case 'ssl':
        // Show SSL help if no additional args
        if (args.length === 1) {
            showSSLHelp();
        } else {
            // Parse SSH args and SSL-specific args
            const config = parseSSLArgs(args.slice(1));
            if (!config.host || !config.username || !config.privateKeyPath || !config.domain || !config.email) {
                showSSLHelp();
                process.exit(1);
            }
            const sslInstaller = new SSLInstaller();
            sslInstaller.config = config;
            sslInstaller.setCertificateConfig(config.domain, config.email);
            sslInstaller.run().catch(console.error);
        }
        break;

    case 'vscode':
        // Show VS Code help if no additional args
        if (args.length === 1) {
            showVSCodeHelp();
        } else {
            // Parse SSH args and VS Code-specific args
            const config = parseVSCodeArgs(args.slice(1));
            if (!config.host || !config.username || !config.privateKeyPath || !config.domain || !config.password) {
                showVSCodeHelp();
                process.exit(1);
            }
            const vscodeInstaller = new VSCodeWebInstaller();
            vscodeInstaller.config = config;
            vscodeInstaller.setVSCodeConfig(config.domain, config.path, config.password);
            vscodeInstaller.run().catch(console.error);
        }
        break;

    case 'cleanup':
        // Run cleanup
        const cleanupCreator = new AWSInstanceCreator(null, 'cleanup');
        cleanupCreator.run().catch(console.error);
        break;

    default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Use "node installer-cli.js help" for available commands.');
        process.exit(1);
}

// Helper functions
function parseSSHArgs(args) {
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
        }
    }
    config.port = config.port || 22;
    config.username = config.username || 'admin';
    return config;
}

function parseSSLArgs(args) {
    const config = parseSSHArgs(args);
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--domain':
            case '-d':
                config.domain = args[++i];
                break;
            case '--email':
            case '-e':
                config.email = args[++i];
                break;
        }
    }
    return config;
}

function parseVSCodeArgs(args) {
    const config = parseSSHArgs(args);
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--domain':
            case '-d':
                config.domain = args[++i];
                break;
            case '--password':
            case '--pwd':
                config.password = args[++i];
                break;
            case '--path':
                config.path = args[++i];
                break;
        }
    }
    config.path = config.path || '/code';
    return config;
}
