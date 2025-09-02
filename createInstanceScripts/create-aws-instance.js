#!/usr/bin/env node

require('dotenv').config();
const { EC2Client, CreateKeyPairCommand, CreateSecurityGroupCommand, AuthorizeSecurityGroupIngressCommand, RunInstancesCommand, DescribeInstancesCommand, DescribeKeyPairsCommand } = require('@aws-sdk/client-ec2');
const fs = require('fs');
const path = require('path');

class AWSInstanceCreator {
    constructor(progressCallback = null, mode = 'create') {
        this.config = {};
        this.progressCallback = progressCallback;
        this.ec2Client = null;
        this.keyPairName = null;
        this.securityGroupId = null;
        this.instanceId = null;
        this.instanceIp = null;
        this.mode = mode; // 'create' or 'cleanup'
    }

    log(message) {
        console.log(message);
        if (this.progressCallback) {
            this.progressCallback(message);
        }
    }

    validateEnvironmentConfig() {
        const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            const errorMsg = `❌ Missing required environment variables: ${missing.join(', ')}\nPlease copy .env.example to .env and fill in your AWS credentials.`;
            this.log(errorMsg);
            throw new Error(errorMsg);
        }

        this.log('✅ AWS environment configuration validated');
    }

    async initializeAWSClient() {
        try {
            this.ec2Client = new EC2Client({
                region: process.env.AWS_REGION || 'eu-central-1',
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                    sessionToken: process.env.AWS_SESSION_TOKEN // optional
                }
            });
            this.log('✅ AWS EC2 client initialized');
        } catch (error) {
            this.log(`❌ Failed to initialize AWS client: ${error.message}`);
            throw error;
        }
    }

    async createKeyPair() {
        try {
            // Generate a unique key pair name with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            this.keyPairName = `debian-trixie-${timestamp}`;

            this.log(`🔑 Creating new key pair: ${this.keyPairName}...`);

            const command = new CreateKeyPairCommand({
                KeyName: this.keyPairName,
                KeyType: 'rsa',
                KeyFormat: 'pem'
            });

            const response = await this.ec2Client.send(command);

            this.log(`✅ Key pair created successfully: ${this.keyPairName}`);
            return response.KeyMaterial;

        } catch (error) {
            this.log(`❌ Failed to create key pair: ${error.message}`);
            throw error;
        }
    }

    async createSecurityGroup() {
        try {
            const groupName = `debian-trixie-sg-${Date.now()}`;
            const description = 'Security group for Debian Trixie instance with HTTP/HTTPS access';

            this.log(`🔒 Creating security group: ${groupName}...`);

            const command = new CreateSecurityGroupCommand({
                GroupName: groupName,
                Description: description,
                VpcId: await this.getDefaultVpcId() // We'll need to implement this
            });

            const response = await this.ec2Client.send(command);
            this.securityGroupId = response.GroupId;

            this.log(`✅ Security group created: ${this.securityGroupId}`);

            // Add inbound rules for SSH, HTTP, and HTTPS
            await this.addSecurityGroupRules();

            return this.securityGroupId;

        } catch (error) {
            this.log(`❌ Failed to create security group: ${error.message}`);
            throw error;
        }
    }

    async getDefaultVpcId() {
        // For simplicity, we'll create instances in the default VPC
        // In production, you might want to specify a VPC ID
        const { DescribeVpcsCommand } = require('@aws-sdk/client-ec2');

        try {
            const command = new DescribeVpcsCommand({
                Filters: [
                    {
                        Name: 'isDefault',
                        Values: ['true']
                    }
                ]
            });

            const response = await this.ec2Client.send(command);
            if (response.Vpcs && response.Vpcs.length > 0) {
                return response.Vpcs[0].VpcId;
            } else {
                throw new Error('No default VPC found');
            }
        } catch (error) {
            this.log(`⚠️ Could not find default VPC: ${error.message}`);
            // Return undefined to let AWS use default VPC
            return undefined;
        }
    }

    async addSecurityGroupRules() {
        try {
            this.log('🔓 Adding security group rules for SSH, HTTP, and HTTPS...');

            const rules = [
                {
                    IpProtocol: 'tcp',
                    FromPort: 22,
                    ToPort: 22,
                    IpRanges: [{ CidrIp: '0.0.0.0/0' }] // SSH from anywhere
                },
                {
                    IpProtocol: 'tcp',
                    FromPort: 80,
                    ToPort: 80,
                    IpRanges: [{ CidrIp: '0.0.0.0/0' }] // HTTP from anywhere
                },
                {
                    IpProtocol: 'tcp',
                    FromPort: 443,
                    ToPort: 443,
                    IpRanges: [{ CidrIp: '0.0.0.0/0' }] // HTTPS from anywhere
                }
            ];

            const command = new AuthorizeSecurityGroupIngressCommand({
                GroupId: this.securityGroupId,
                IpPermissions: rules
            });

            await this.ec2Client.send(command);
            this.log('✅ Security group rules added successfully');

        } catch (error) {
            this.log(`❌ Failed to add security group rules: ${error.message}`);
            throw error;
        }
    }

    async createInstance(keyMaterial) {
        try {
            this.log('🚀 Launching t3.small Debian 13 Trixie instance...');

            // Debian 13 Trixie AMI ID for eu-central-1 (free, no marketplace subscription needed)
            const amiId = 'ami-0f439e819ba112bd7'; // Debian 13 (20250814-2204) - free AMI

            const command = new RunInstancesCommand({
                ImageId: amiId,
                MinCount: 1,
                MaxCount: 1,
                InstanceType: 't3.small',
                KeyName: this.keyPairName,
                SecurityGroupIds: this.securityGroupId ? [this.securityGroupId] : [],
                TagSpecifications: [
                    {
                        ResourceType: 'instance',
                        Tags: [
                            {
                                Key: 'Name',
                                Value: 'Debian-13-Trixie-Instance'
                            },
                            {
                                Key: 'CreatedBy',
                                Value: 'AWS-Instance-Creator-Script'
                            }
                        ]
                    }
                ]
            });

            const response = await this.ec2Client.send(command);
            this.instanceId = response.Instances[0].InstanceId;

            this.log(`✅ Instance launched successfully: ${this.instanceId}`);
            return response;

        } catch (error) {
            this.log(`❌ Failed to launch instance: ${error.message}`);
            throw error;
        }
    }

    async waitForInstanceReady() {
        try {
            this.log('⏳ Waiting for instance to be in running state...');

            let instanceRunning = false;
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max wait

            while (!instanceRunning && attempts < maxAttempts) {
                const command = new DescribeInstancesCommand({
                    InstanceIds: [this.instanceId]
                });

                const response = await this.ec2Client.send(command);
                const instance = response.Reservations[0].Instances[0];

                if (instance.State.Name === 'running') {
                    instanceRunning = true;
                    this.instanceIp = instance.PublicIpAddress;
                    this.log(`✅ Instance is now running with IP: ${this.instanceIp}`);
                    break;
                }

                this.log(`🔄 Instance state: ${instance.State.Name}, waiting...`);
                await this.sleep(5000); // Wait 5 seconds
                attempts++;
            }

            if (!instanceRunning) {
                throw new Error('Timeout waiting for instance to become ready');
            }

        } catch (error) {
            this.log(`❌ Failed waiting for instance: ${error.message}`);
            throw error;
        }
    }

    async saveKeyPair(keyMaterial) {
        try {
            const keyFileName = `${this.instanceIp}.pem`;
            const keyFilePath = path.join(process.cwd(), keyFileName);

            this.log(`💾 Saving key pair to: ${keyFileName}`);

            fs.writeFileSync(keyFilePath, keyMaterial, { mode: 0o600 });
            this.log(`✅ Key pair saved successfully: ${keyFileName}`);

            // Also create a .pub file for the public key
            const publicKeyFile = `${this.instanceIp}.pub`;
            const publicKeyPath = path.join(process.cwd(), publicKeyFile);

            // Note: AWS doesn't provide the public key directly, but we can generate it
            this.log(`📝 Note: Public key file would be: ${publicKeyFile} (generate from private key if needed)`);

            return keyFileName;

        } catch (error) {
            this.log(`❌ Failed to save key pair: ${error.message}`);
            throw error;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanupOnFailure() {
        try {
            this.log('🧹 Cleaning up resources due to failure...');

            // Terminate instance if it was created
            if (this.instanceId) {
                const { TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
                const command = new TerminateInstancesCommand({
                    InstanceIds: [this.instanceId]
                });
                await this.ec2Client.send(command);
                this.log(`✅ Instance terminated: ${this.instanceId}`);
            }

            // Delete security group if it was created
            if (this.securityGroupId) {
                const { DeleteSecurityGroupCommand } = require('@aws-sdk/client-ec2');
                const command = new DeleteSecurityGroupCommand({
                    GroupId: this.securityGroupId
                });
                await this.ec2Client.send(command);
                this.log(`✅ Security group deleted: ${this.securityGroupId}`);
            }

            // Delete key pair if it was created
            if (this.keyPairName) {
                const { DeleteKeyPairCommand } = require('@aws-sdk/client-ec2');
                const command = new DeleteKeyPairCommand({
                    KeyName: this.keyPairName
                });
                await this.ec2Client.send(command);
                this.log(`✅ Key pair deleted: ${this.keyPairName}`);
            }

        } catch (cleanupError) {
            this.log(`⚠️ Cleanup failed: ${cleanupError.message}`);
        }
    }

    async cleanupResources(instanceId = null, keyPairName = null, securityGroupId = null) {
        try {
            this.log('🧹 Starting cleanup of AWS resources...');

            // If specific resources provided, use them; otherwise use instance variables
            const targetInstanceId = instanceId || this.instanceId;
            const targetKeyPairName = keyPairName || this.keyPairName;
            const targetSecurityGroupId = securityGroupId || this.securityGroupId;

            // Terminate instance first
            if (targetInstanceId) {
                try {
                    this.log(`🔄 Terminating instance: ${targetInstanceId}`);
                    const { TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
                    const command = new TerminateInstancesCommand({
                        InstanceIds: [targetInstanceId]
                    });
                    await this.ec2Client.send(command);
                    this.log(`✅ Instance terminated: ${targetInstanceId}`);

                    // Wait for instance to be terminated
                    await this.waitForInstanceTermination(targetInstanceId);
                } catch (error) {
                    this.log(`⚠️ Could not terminate instance ${targetInstanceId}: ${error.message}`);
                }
            }

            // Delete security group (skip default security group)
            if (targetSecurityGroupId) {
                // First check if this is the default security group
                try {
                    const { DescribeSecurityGroupsCommand } = require('@aws-sdk/client-ec2');
                    const checkCommand = new DescribeSecurityGroupsCommand({
                        GroupIds: [targetSecurityGroupId]
                    });
                    const checkResponse = await this.ec2Client.send(checkCommand);

                    if (checkResponse.SecurityGroups && checkResponse.SecurityGroups[0].GroupName === 'default') {
                        this.log(`⛔️ Skipping deletion of default security group: ${targetSecurityGroupId}`);
                        this.log(`   Default security groups should never be deleted!`);
                        return;
                    }
                } catch (checkError) {
                    this.log(`⚠️ Could not verify security group ${targetSecurityGroupId}: ${checkError.message}`);
                    return;
                }

                try {
                    this.log(`🔄 Deleting security group: ${targetSecurityGroupId}`);
                    const { DeleteSecurityGroupCommand } = require('@aws-sdk/client-ec2');
                    const command = new DeleteSecurityGroupCommand({
                        GroupId: targetSecurityGroupId
                    });
                    await this.ec2Client.send(command);
                    this.log(`✅ Security group deleted: ${targetSecurityGroupId}`);
                } catch (error) {
                    this.log(`⚠️ Could not delete security group ${targetSecurityGroupId}: ${error.message}`);
                }
            }

            // Delete key pair
            if (targetKeyPairName) {
                try {
                    this.log(`🔄 Deleting key pair: ${targetKeyPairName}`);
                    const { DeleteKeyPairCommand } = require('@aws-sdk/client-ec2');
                    const command = new DeleteKeyPairCommand({
                        KeyName: targetKeyPairName
                    });
                    await this.ec2Client.send(command);
                    this.log(`✅ Key pair deleted: ${targetKeyPairName}`);

                    // Remove local key file if it exists
                    const localKeyFile = this.findLocalKeyFile(targetKeyPairName);
                    if (localKeyFile) {
                        fs.unlinkSync(localKeyFile);
                        this.log(`✅ Local key file removed: ${localKeyFile}`);
                    }
                } catch (error) {
                    this.log(`⚠️ Could not delete key pair ${targetKeyPairName}: ${error.message}`);
                }
            }

            this.log('🎉 Cleanup completed successfully!');

        } catch (error) {
            this.log(`❌ Cleanup failed: ${error.message}`);
            throw error;
        }
    }

    async waitForInstanceTermination(instanceId) {
        this.log('⏳ Waiting for instance to terminate...');
        let attempts = 0;
        const maxAttempts = 30; // 5 minutes max wait

        while (attempts < maxAttempts) {
            try {
                const command = new DescribeInstancesCommand({
                    InstanceIds: [instanceId]
                });

                const response = await this.ec2Client.send(command);
                const instance = response.Reservations[0].Instances[0];
                const state = instance.State.Name;

                if (state === 'terminated') {
                    this.log('✅ Instance fully terminated');
                    return;
                }

                this.log(`🔄 Instance state: ${state}, waiting...`);
                await this.sleep(10000); // Wait 10 seconds
                attempts++;
            } catch (error) {
                // Instance might already be gone
                this.log('✅ Instance appears to be terminated');
                return;
            }
        }

        this.log('⚠️ Instance termination taking longer than expected, but continuing cleanup...');
    }

    findLocalKeyFile(keyPairName) {
        // Look for key files that might match the keypair name or IP pattern
        const files = fs.readdirSync('.');
        const pemFiles = files.filter(file => file.endsWith('.pem'));

        // First try to find by keypair name
        let keyFile = pemFiles.find(file => file.includes(keyPairName));
        if (keyFile) return keyFile;

        // If not found, look for IP-based naming (our script creates files like 18.195.241.96.pem)
        keyFile = pemFiles.find(file => /^\d+\.\d+\.\d+\.\d+\.pem$/.test(file));
        if (keyFile) return keyFile;

        return null;
    }

    async findExistingResources() {
        try {
            this.log('🔍 Looking for existing AWS resources to clean up...');

            const resources = {
                instances: [],
                keyPairs: [],
                securityGroups: []
            };

            // Find running instances
            const { DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
            const instancesCommand = new DescribeInstancesCommand({
                Filters: [
                    {
                        Name: 'instance-state-name',
                        Values: ['running', 'pending', 'stopped']
                    },
                    {
                        Name: 'tag:Name',
                        Values: ['Debian-13-Trixie-Instance*']
                    }
                ]
            });

            const instancesResponse = await this.ec2Client.send(instancesCommand);
            if (instancesResponse.Reservations) {
                resources.instances = instancesResponse.Reservations
                    .flatMap(reservation => reservation.Instances)
                    .map(instance => ({
                        id: instance.InstanceId,
                        ip: instance.PublicIpAddress,
                        state: instance.State.Name
                    }));
            }

            // Find key pairs
            const { DescribeKeyPairsCommand } = require('@aws-sdk/client-ec2');
            const keyPairsCommand = new DescribeKeyPairsCommand({});
            const keyPairsResponse = await this.ec2Client.send(keyPairsCommand);

            if (keyPairsResponse.KeyPairs) {
                resources.keyPairs = keyPairsResponse.KeyPairs
                    .filter(kp => kp.KeyName.startsWith('debian-trixie-'))
                    .map(kp => kp.KeyName);
            }

            // Find security groups (exclude default security group)
            const { DescribeSecurityGroupsCommand } = require('@aws-sdk/client-ec2');
            const securityGroupsCommand = new DescribeSecurityGroupsCommand({
                Filters: [
                    {
                        Name: 'description',
                        Values: ['Security group for Debian Trixie instance*']
                    }
                ]
            });

            const securityGroupsResponse = await this.ec2Client.send(securityGroupsCommand);
            if (securityGroupsResponse.SecurityGroups) {
                // Filter out the default security group which should never be deleted
                resources.securityGroups = securityGroupsResponse.SecurityGroups
                    .filter(sg => sg.GroupName !== 'default')
                    .map(sg => ({
                        id: sg.GroupId,
                        name: sg.GroupName
                    }));
            }

            return resources;

        } catch (error) {
            this.log(`⚠️ Error finding existing resources: ${error.message}`);
            return { instances: [], keyPairs: [], securityGroups: [] };
        }
    }

    async run() {
        try {
            // Validate environment
            this.validateEnvironmentConfig();

            // Initialize AWS client
            await this.initializeAWSClient();

            if (this.mode === 'cleanup') {
                await this.runCleanup();
            } else {
                await this.runCreate();
            }

        } catch (error) {
            this.log(`❌ Operation failed: ${error.message}`);
            process.exit(1);
        }
    }

    async runCreate() {
        let success = false;

        try {
            // Create key pair
            const keyMaterial = await this.createKeyPair();

            // Create security group
            await this.createSecurityGroup();

            // Create instance
            await this.createInstance(keyMaterial);

            // Wait for instance to be ready
            await this.waitForInstanceReady();

            // Save key pair with IP as filename
            const keyFileName = await this.saveKeyPair(keyMaterial);

            success = true;

            this.log('🎉 AWS EC2 instance creation completed successfully!');
            this.log(`📋 Summary:`);
            this.log(`   Instance ID: ${this.instanceId}`);
            this.log(`   Public IP: ${this.instanceIp}`);
            this.log(`   Key Pair File: ${keyFileName}`);
            this.log(`   Security Group: ${this.securityGroupId}`);
            this.log(`   SSH Command: ssh -i ${keyFileName} admin@${this.instanceIp}`);

        } catch (error) {
            this.log(`❌ Instance creation failed: ${error.message}`);
            await this.cleanupOnFailure();
            throw error;
        }
    }

    async runCleanup() {
        try {
            // Check command line arguments for specific resources
            const args = process.argv.slice(2);
            const specificCleanup = this.parseCleanupArgs(args);

            if (specificCleanup) {
                // Clean up specific resources
                await this.cleanupResources(
                    specificCleanup.instanceId,
                    specificCleanup.keyPairName,
                    specificCleanup.securityGroupId
                );
            } else {
                // Auto-discover and clean up all resources
                const resources = await this.findExistingResources();

                if (resources.instances.length === 0 && resources.keyPairs.length === 0 && resources.securityGroups.length === 0) {
                    this.log('ℹ️ No existing resources found to clean up.');
                    return;
                }

                this.log('\n📋 Found existing resources:');
                if (resources.instances.length > 0) {
                    this.log(`   Instances: ${resources.instances.map(i => `${i.id} (${i.ip})`).join(', ')}`);
                }
                if (resources.keyPairs.length > 0) {
                    this.log(`   Key Pairs: ${resources.keyPairs.join(', ')}`);
                }
                if (resources.securityGroups.length > 0) {
                    this.log(`   Security Groups: ${resources.securityGroups.map(sg => sg.id).join(', ')}`);
                }

                // Ask for confirmation (unless --yes flag is used)
                if (!args.includes('--yes') && !args.includes('-y')) {
                    this.log('\n⚠️ This will terminate all found instances and delete associated resources.');
                    this.log('❓ Continue? (y/N): ');

                    const readline = require('readline');
                    const rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });

                    const answer = await new Promise(resolve => {
                        rl.question('', (answer) => {
                            rl.close();
                            resolve(answer.toLowerCase());
                        });
                    });

                    if (answer !== 'y' && answer !== 'yes') {
                        this.log('ℹ️ Cleanup cancelled by user.');
                        return;
                    }
                }

                // Clean up all found resources
                for (const instance of resources.instances) {
                    await this.cleanupResources(instance.id, null, null);
                }

                for (const keyPair of resources.keyPairs) {
                    await this.cleanupResources(null, keyPair, null);
                }

                for (const securityGroup of resources.securityGroups) {
                    await this.cleanupResources(null, null, securityGroup.id);
                }
            }

        } catch (error) {
            this.log(`❌ Cleanup failed: ${error.message}`);
            throw error;
        }
    }

    parseCleanupArgs(args) {
        const cleanupArgs = {};

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            switch (arg) {
                case '--instance':
                case '-i':
                    cleanupArgs.instanceId = args[++i];
                    break;
                case '--keypair':
                case '-k':
                    cleanupArgs.keyPairName = args[++i];
                    break;
                case '--security-group':
                case '-s':
                    cleanupArgs.securityGroupId = args[++i];
                    break;
            }
        }

        return Object.keys(cleanupArgs).length > 0 ? cleanupArgs : null;
    }
}

// Run the creator if this file is executed directly
if (require.main === module) {
    const args = process.argv.slice(2);

    // Check for cleanup mode
    if (args.includes('--cleanup') || args.includes('--remove') || args.includes('--delete')) {
        const creator = new AWSInstanceCreator(null, 'cleanup');
        creator.run().catch(console.error);
    } else if (args.includes('--help') || args.includes('-h')) {
        showHelp();
    } else {
        const creator = new AWSInstanceCreator();
        creator.run().catch(console.error);
    }
}

function showHelp() {
    console.log(`
AWS EC2 Instance Creator/Cleaner

USAGE:
  node create-aws-instance.js                    # Create new instance
  node create-aws-instance.js --cleanup         # Clean up existing resources
  node create-aws-instance.js --help            # Show this help

CREATE MODE:
  Creates a t3.small Debian 13 Trixie instance with:
  - Fresh SSH keypair (named after instance IP)
  - Security group with HTTP/HTTPS enabled
  - Instance ready for SSH connection

CLEANUP MODE:
  Removes AWS resources created by this script:

  Auto-discovery mode:
    node create-aws-instance.js --cleanup
    # Finds and removes all instances, keypairs, and security groups

  Specific resource mode:
    node create-aws-instance.js --cleanup --instance i-1234567890abcdef0
    node create-aws-instance.js --cleanup --keypair debian-trixie-2025-09-02T07-23-48
    node create-aws-instance.js --cleanup --security-group sg-12345678

  Skip confirmation:
    node create-aws-instance.js --cleanup --yes

EXAMPLES:
  # Create new instance
  node createInstanceScripts/create-aws-instance.js

  # Clean up everything (with confirmation)
  node createInstanceScripts/create-aws-instance.js --cleanup

  # Clean up specific instance without confirmation
  node createInstanceScripts/create-aws-instance.js --cleanup --instance i-1234567890abcdef0 --yes

  # Clean up multiple specific resources
  node createInstanceScripts/create-aws-instance.js --cleanup --instance i-123 --keypair my-key --security-group sg-456

NOTES:
  - Cleanup removes local .pem files automatically
  - Use --yes to skip confirmation prompts
  - Resources are cleaned up in safe order (instance first, then security group, then keypair)
  - Default security groups are automatically protected from deletion
`);
}

module.exports = AWSInstanceCreator;
