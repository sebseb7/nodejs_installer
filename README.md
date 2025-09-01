[![Download Latest Release](https://img.shields.io/badge/Download-v2.0.0-blue?style=for-the-badge&logo=github)](https://github.com/sebseb7/nodejs_installer/releases/download/v2.0.0/Debian.Development.Stack.Installer.Setup.2.0.0.exe)

<img width="395" height="900" alt="image" src="https://github.com/user-attachments/assets/3e385d9b-b710-4a4a-b587-884aea7fe70c" />


# Let's Encrypt SSL Certificate Installer

A streamlined application that connects to a Debian host via SSH and installs Let's Encrypt SSL certificates with domain reachability verification.

## Features

- 🔐 SSH authentication using private key (.pem or .ppk format)
- 🛡️ Secure sudo-based installation
- 🌐 **Domain Reachability Testing**: Places test file in `/usr/share/nginx/html` and verifies domain accessibility
- 📦 **SSL Certificate Installation**:
  - Certbot installation from official Debian packages
  - Let's Encrypt SSL certificate obtainment using nginx plugin
  - Automatic certificate renewal (handled by certbot)
- ✅ Comprehensive error handling and logging
- 🔄 Real-time command execution feedback
- 🖥️ **GUI Version**: Modern Electron-based interface for SSL installation

## Prerequisites

- Node.js installed locally (for running this installer)
- SSH access to target Debian host as "admin" user
- SSH private key in .pem or .ppk format
- Target host should have `sudo` configured for the admin user

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

The GUI application configures everything through the interface:

- **IP/Host**: Enter your server address or hostname
- **Username**: SSH username (defaults to "admin")
- **SSH Key**: Browse and select your private key file (.pem or .ppk)
- **Passphrase**: Optional SSH key passphrase

## Usage

### GUI Version (Recommended)

Launch the modern graphical interface:

```bash
npm start
```

The GUI provides:
- **IP/Host field**: Enter your server address
- **User field**: Username (defaults to "admin")
- **SSH key file selector**: Browse and select your SSH private key (.pem or .ppk)
- **Domain field**: Enter the domain name for SSL certificate installation
- **Email field**: Enter email address for Let's Encrypt account
- **Install SSL button**: Install SSL certificate with domain verification

### CLI Version (Development)

Run the command-line version for development/testing:

```bash
npm run cli
```

Or directly with Node.js:

```bash
node index.js
```

**Note**: CLI version requires environment variables to be set. Use the GUI for production use.

## What it does

The SSL installer will:

1. **Validate Configuration**: Check SSH key and connection parameters
2. **Establish SSH Connection**: Connect to the target Debian host
3. **Domain Reachability Test**: Place test file in `/usr/share/nginx/html/.well-known/acme-challenge/` and verify domain accessibility
4. **Install Certbot**: Install certbot and python3-certbot-nginx from official Debian packages
5. **Obtain SSL Certificate**: Use `certbot certonly --nginx` to obtain Let's Encrypt certificate
6. **Certificate Storage**: Save certificates to `/etc/letsencrypt/live/domain.com/`
7. **Auto-Renewal**: Certbot automatically handles certificate renewal

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
- **Domain field**: Enter the domain name for SSL certificate
- **Email field**: Enter email address for Let's Encrypt registration
- **Install SSL button**: Install SSL certificate for the specified domain

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
