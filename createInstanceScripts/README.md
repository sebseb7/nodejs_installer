# AWS EC2 Instance Creation Scripts

This directory contains scripts for creating and managing AWS EC2 instances with pre-configured settings.

## AWS Instance Creator/Cleaner (`create-aws-instance.js`)

Creates a t3.small Debian 13 Trixie instance in eu-central-1 with HTTP/HTTPS enabled and a fresh keypair. Also provides comprehensive cleanup functionality.

### Prerequisites

1. **AWS Account**: You need an AWS account with appropriate permissions
2. **AWS CLI Credentials**: Configure your AWS credentials
3. **Node.js**: Make sure Node.js is installed

### Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure AWS credentials**:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your AWS credentials:
   ```
   AWS_ACCESS_KEY_ID=your-access-key-id
   AWS_SECRET_ACCESS_KEY=your-secret-access-key
   AWS_REGION=eu-central-1
   ```

3. **Make the script executable**:
   ```bash
   chmod +x createInstanceScripts/create-aws-instance.js
   ```

### Usage

#### Create a New Instance

Run the script to create a new instance:

```bash
node createInstanceScripts/create-aws-instance.js
```

#### Clean Up Resources

The script also provides comprehensive cleanup functionality:

**Auto-discovery cleanup** (finds and removes all resources):
```bash
node createInstanceScripts/create-aws-instance.js --cleanup
```

**Specific resource cleanup**:
```bash
# Clean up specific instance
node createInstanceScripts/create-aws-instance.js --cleanup --instance i-1234567890abcdef0

# Clean up specific keypair
node createInstanceScripts/create-aws-instance.js --cleanup --keypair debian-trixie-2025-09-02T07-25-12

# Clean up specific security group
node createInstanceScripts/create-aws-instance.js --cleanup --security-group sg-12345678

# Skip confirmation prompts
node createInstanceScripts/create-aws-instance.js --cleanup --yes
```

**Help and usage information**:
```bash
node createInstanceScripts/create-aws-instance.js --help
```

Or make it executable and run directly:

```bash
./createInstanceScripts/create-aws-instance.js
./createInstanceScripts/create-aws-instance.js --cleanup
./createInstanceScripts/create-aws-instance.js --help
```

### What the script does

#### Create Mode:
1. **Validates AWS credentials** from `.env` file
2. **Creates a new SSH keypair** with timestamp-based name
3. **Creates a security group** with rules for:
   - SSH (port 22)
   - HTTP (port 80)
   - HTTPS (port 443)
4. **Launches a t3.small instance** with Debian 13 Trixie
5. **Waits for the instance** to be in running state
6. **Saves the private key** as `{instance-ip}.pem`
7. **Displays connection information**

#### Cleanup Mode:
1. **Auto-discovers resources** created by this script
2. **Terminates instances** safely (waiting for full termination)
3. **Deletes security groups** and keypairs (skips default security group)
4. **Removes local .pem files** automatically
5. **Provides confirmation prompts** (unless `--yes` is used)

### Output

After successful creation, you'll see:
- Instance ID
- Public IP address
- SSH connection command
- Key file location

### Example Output

```
✅ AWS environment configuration validated
✅ AWS EC2 client initialized
🔑 Creating new key pair: debian-trixie-2024-01-15T10-30-00...
✅ Key pair created successfully
🔒 Creating security group...
✅ Security group created
🔓 Adding security group rules...
✅ Security group rules added
🚀 Launching t3.small Debian 13 Trixie instance...
✅ Instance launched successfully
⏳ Waiting for instance to be ready...
✅ Instance is now running with IP: 18.156.123.45
💾 Saving key pair to: 18.156.123.45.pem
🎉 AWS EC2 instance creation completed successfully!
📋 Summary:
   Instance ID: i-1234567890abcdef0
   Public IP: 18.156.123.45
   Key Pair File: 18.156.123.45.pem
   Security Group: sg-12345678
   SSH Command: ssh -i 18.156.123.45.pem admin@18.156.123.45
```

### Connecting to your instance

After creation, connect using SSH:

```bash
ssh -i {instance-ip}.pem admin@{instance-ip}
```

### Cleanup

The script automatically cleans up AWS resources if creation fails. For manual cleanup:

- Terminate the instance from AWS EC2 console
- Delete the security group
- Delete the key pair
- Delete the local `.pem` file

### Security Notes

- The security group allows SSH, HTTP, and HTTPS from anywhere (0.0.0.0/0)
- Consider restricting access for production use
- The private key file is saved with 600 permissions
- Keep your `.env` file secure and never commit it to version control
- **Default security groups are automatically protected** from accidental deletion

### Troubleshooting

**AMI ID outdated**: The script uses a specific Debian 13 AMI ID. If it fails, check for the latest Debian 13 AMI in eu-central-1.

**Permissions error**: Ensure your AWS credentials have permissions for EC2 operations.

**VPC issues**: The script uses the default VPC. If you have a custom VPC setup, you may need to modify the script.
