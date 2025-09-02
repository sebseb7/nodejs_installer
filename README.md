[![Download Latest Release](https://img.shields.io/badge/Download-v4.0.0-blue?style=for-the-badge&logo=github)](https://github.com/sebseb7/nodejs_installer/releases/download/v4.0.0/Debian.Development.Stack.Installer.Setup.4.0.0.exe)

https://youtu.be/gTZRIWz_900

<img width="370" height="599" alt="image" src="https://github.com/user-attachments/assets/cd8803d9-e0bc-4b77-8e57-171e413c94d2" />



# Debian Development Stack Installer v4.0.0

A comprehensive SSH-based installer for Debian hosts that provides Node.js, Nginx, development tools, SSL certificates, static website deployment, and VS Code Web server with automated configuration.

## Features

- 🔐 SSH authentication using private key (.pem or .ppk format)
- 🛡️ Secure sudo-based installation
- 🌐 **Domain Reachability Testing**: Places test file in `/usr/share/nginx/html` and verifies domain accessibility
- 📦 **SSL Certificate Installation**:
  - Certbot installation from official Debian packages
  - Let's Encrypt SSL certificate obtainment using nginx plugin
  - Automatic certificate renewal (handled by certbot)
- 🌐 **Static Website Deployment** (NEW in v3.0.0):
  - Upload and extract ZIP files containing static websites
  - Automatic nginx configuration generation
  - SSL integration when certificates are available
  - Clean deployment with proper file permissions
- 📝 **VS Code Web Server** (NEW in v4.0.0):
  - Install and configure VS Code Server (code-server)
  - Automatic nginx reverse proxy setup with WebSocket support
  - Secure password authentication with argon2 hashing
  - SSL integration for HTTPS access
  - Customizable URL path (default: /code)
- ✅ Comprehensive error handling and logging
- 🔄 Real-time command execution feedback
- 🖥️ **GUI Version**: Modern Electron-based interface for all installation tasks

## Prerequisites

- SSH access to target Debian host as "admin" user
- SSH private key in .pem or .ppk format

## System Compatibility

This installer has been tested and verified to work on:
- **AWS EC2 t3.micro instance** running **Debian 13** (Trixie)

**Important**: When creating your AWS EC2 instance, ensure that **HTTP (port 80)** and **HTTPS (port 443)** access are enabled in the security group. These ports are required for:
- SSL certificate installation (HTTP-01 ACME challenges)
- Serving your website over HTTPS

## Configuration

The GUI application configures everything through the interface:

- **IP/Host**: Enter your server address or hostname
- **Username**: SSH username (defaults to "admin")
- **SSH Key**: Browse and select your private key file (.pem or .ppk)
- **Passphrase**: Optional SSH key passphrase

## Usage

Launch the application to open the modern graphical interface.

The GUI provides:
- **IP/Host field**: Enter your server address
- **User field**: Username (defaults to "admin")
- **SSH key file selector**: Browse and select your SSH private key (.pem or .ppk)
- **Domain field**: Enter the domain name for SSL certificate installation
- **Email field**: Enter email address for Let's Encrypt account
- **Install SSL button**: Install SSL certificate with domain verification

## What it does

The installer provides comprehensive deployment capabilities:

### SSL Certificate Installation
1. **Validate Configuration**: Check SSH key and connection parameters
2. **Establish SSH Connection**: Connect to the target Debian host
3. **Domain Reachability Test**: Place test file in `/usr/share/nginx/html/.well-known/acme-challenge/` and verify domain accessibility
4. **Install Certbot**: Install certbot and python3-certbot-nginx from official Debian packages
5. **Obtain SSL Certificate**: Use `certbot certonly --nginx` to obtain Let's Encrypt certificate
6. **Certificate Storage**: Save certificates to `/etc/letsencrypt/live/domain.com/`
7. **Auto-Renewal**: Certbot automatically handles certificate renewal

### Static Website Deployment
1. **Clean Installation**: Remove existing nginx config and webroot for the domain
2. **ZIP File Upload**: Securely upload and extract static website files (requires unzip)
3. **Webroot Creation**: Set up `~/webroot/<domain>` with proper permissions
4. **Nginx Configuration**: Generate nginx config at `/etc/nginx/conf.d/<domain>.conf`
5. **SSL Integration**: Automatically enable HTTPS if SSL certificate exists
6. **Service Reload**: Restart nginx to apply new configuration

**Dependencies**: Requires Nginx and Basic Tools (for unzip functionality)

### VS Code Web Server Installation
1. **SSL Verification**: Check that SSL certificate exists for the specified domain
2. **Code-Server Installation**: Download and install VS Code Server from official repository
3. **Service Setup**: Enable and start code-server service for the current user
4. **Password Security**: Generate argon2 hash for the provided password
5. **Configuration**: Create code-server config with secure settings
6. **Nginx Proxy**: Add reverse proxy location block to nginx configuration
7. **WebSocket Support**: Configure proper WebSocket proxy headers for VS Code
8. **SSL Integration**: Ensure all traffic goes through HTTPS

**Dependencies**: Requires Nginx and Let's Encrypt SSL certificate for the domain
**Access**: Available at `https://yourdomain.com/code` (or custom path) with password authentication

### Development Stack Installation
- **Node.js LTS**: Install from NodeSource repository with npm
- **Nginx**: Install web server from official Debian packages
- **Basic Tools**: Install development essentials (git, htop, ripgrep, build-essential, unzip, etc.)

## GUI Interface

The Electron-based GUI provides an intuitive interface with:

**Features:**
- **Real-time logging**: Live progress updates during operations
- **Visual feedback**: Clear success/error indicators
- **File browser**: Native file picker for SSH key selection
- **Progress indicators**: Spinners and status messages
- **Responsive design**: Modern Bootstrap-based interface

**Interface Elements:**
- **IP/Host field**: Enter your server address or hostname
- **User field**: SSH username (defaults to "admin")
- **SSH key file selector**: Browse and select your SSH private key file (.pem or .ppk)
- **Installation Options**:
  - Node.js LTS: Install Node.js from NodeSource repository
  - Nginx: Install web server from official Debian packages
  - Basic Tools: Install development tools (git, htop, ripgrep, etc.)
  - Let's Encrypt SSL: Install SSL certificates with auto-renewal
  - **Static Website**: Deploy static website from ZIP file (NEW)
  - **VS Code Web**: Install VS Code Server with web interface (NEW)
- **SSL Configuration**: Domain and email for Let's Encrypt certificates
- **Static Website Configuration**: Domain and ZIP file for website deployment
- **VS Code Web Configuration**: Domain, path, and password for VS Code Server
- **Action Buttons**: Check status or install selected components

## Security Notes

- The SSH private key should have appropriate permissions (600)
- Ensure the "admin" user has sudo privileges on the target host
- The installer uses `sudo -E` to preserve environment variables when running the NodeSource setup script

## Troubleshooting

### Connection Issues
- Verify SSH key permissions: `chmod 600 admin-key.pem` or `chmod 600 admin-key.ppk`
- Ensure the "admin" user exists and has SSH access
- Check that SSH port (default 22) is accessible

### Permission Issues
- Verify the "admin" user has sudo privileges
- Check that passwordless sudo is configured (recommended for automation)

### SSL Installation Failures
- Ensure the target system is Debian-based
- Check internet connectivity on the target host
- Verify that nginx is installed and running
- Ensure the domain DNS points to the server
- Check that port 80 is accessible for ACME challenges
- Verify that apt package manager is available and functional

### Domain Issues
- Verify domain DNS A/AAAA records point to server IP
- Ensure domain is accessible via HTTP (port 80)
- Check that nginx can serve files from `/usr/share/nginx/html/`
- Confirm domain doesn't have existing SSL certificate conflicts

## Example Output

```
✅ Configuration validated
🔗 Connecting to admin@your-server.com:22...
✅ SSH connection established
🚀 Starting SSL certificate installation...
🌐 Testing domain reachability...
🔄 Creating ACME challenge directory in nginx default root...
✅ Setting nginx default root ownership completed
🔄 Creating domain reachability test file...
✅ Creating domain reachability test file completed
🔍 Testing if example.com can reach the test file...
✅ Domain example.com is reachable and can access test files
🔧 Installing Certbot...
🔄 Updating package list...
✅ Updating package list completed
🔄 Installing Certbot...
✅ Installing Certbot completed
🔄 Verifying Certbot...
✅ Certbot installed successfully
🔐 Obtaining SSL certificate for example.com...
🔄 Obtaining SSL certificate...
✅ SSL certificate obtained successfully
📅 Certbot will handle automatic renewal
🎉 SSL certificate installation completed successfully!
📋 Domain: example.com
📋 Email: admin@example.com
📄 SSL certificates saved to /etc/letsencrypt/live/example.com/
✅ All operations completed successfully!
🔌 SSH connection closed
```

## License

0BSD
