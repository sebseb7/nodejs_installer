[![Download Latest Release](https://img.shields.io/badge/Download-v1.0.0-blue?style=for-the-badge&logo=github)](https://github.com/sebseb7/nodejs_installer/releases/download/v1.0.0/Debian.Node.js.Installer.Setup.1.0.0.exe)

<img width="419" height="1000" alt="image" src="https://github.com/user-attachments/assets/bbfcd7b3-595e-4d09-acc1-8db1ee97b618" />

# Debian Node.js LTS Installer

A Node.js application that automatically connects to a Debian host via SSH and installs Node.js LTS using the official NodeSource repository.

## Features

- 🔐 SSH authentication using private key (.pem format)
- 🛡️ Secure sudo-based installation
- 📦 Official NodeSource repository for latest LTS
- ✅ Comprehensive error handling and logging
- 🔄 Real-time command execution feedback
- 🖥️ **GUI Version**: Modern Electron-based interface
- 🔍 **Smart Installation**: Checks for existing Node.js before installing

## Prerequisites

- Node.js installed locally (for running this installer)
- SSH access to target Debian host as "admin" user
- SSH private key in .pem format
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
- **SSH Key**: Browse and select your private key file (.pem)
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
- **PEM file selector**: Browse and select your SSH private key
- **Check button**: Verify Node.js installation status
- **Install button**: Install Node.js LTS if not present

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

The installer will:

1. **Validate Configuration**: Check that all required environment variables are set and SSH key exists
2. **Check Existing Installation**: Verify if Node.js is already installed on the target system
3. **Establish SSH Connection**: Connect to the target host as "admin" user
4. **Smart Installation**: Only proceed with installation if Node.js is not already present
5. **Update Package List**: Run `sudo apt update`
6. **Install Dependencies**: Install `curl` (Debian-compatible, no Ubuntu-specific packages)
7. **Add NodeSource Repository**: Add the official NodeSource repository for LTS
8. **Install Node.js LTS**: Install Node.js and npm via `sudo apt install nodejs`
9. **Verify Installation**: Check Node.js and npm versions

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
- **PEM file selector**: Browse and select your SSH private key file
- **Check button**: Verify current Node.js installation status
- **Install button**: Install Node.js LTS if not already present

## Security Notes

- The SSH private key should have appropriate permissions (600)
- Ensure the "admin" user has sudo privileges on the target host
- The installer uses `sudo -E` to preserve environment variables when running the NodeSource setup script

## Troubleshooting

### Connection Issues
- Verify SSH key permissions: `chmod 600 admin-key.pem`
- Ensure the "admin" user exists and has SSH access
- Check that SSH port (default 22) is accessible

### Permission Issues
- Verify the "admin" user has sudo privileges
- Check that passwordless sudo is configured (recommended for automation)

### Installation Failures
- Ensure the target system is Debian-based
- Check internet connectivity on the target host
- Verify that apt package manager is available and functional

## Example Output

```
✅ Configuration validated
🔗 Connecting to admin@your-server.com:22...
✅ SSH connection established
🚀 Starting Node.js LTS installation...
🔄 Updating package list...
Get:1 http://deb.debian.org/debian bullseye InRelease [116 kB]
...
✅ Updating package list completed
🔄 Installing curl and software-properties-common...
...
✅ Installing curl and software-properties-common completed
🔄 Adding NodeSource repository...
...
✅ Adding NodeSource repository completed
🔄 Installing Node.js LTS...
...
✅ Installing Node.js LTS completed
🔄 Verifying Node.js installation...
v18.19.0
9.6.7
✅ Verifying Node.js installation completed
🎉 Node.js LTS installation completed successfully!
📋 Installed versions: v18.19.0
9.6.7
✅ All operations completed successfully!
🔌 SSH connection closed
```

## License

MIT
