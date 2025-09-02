#!/usr/bin/env node

require('dotenv').config();
const { EC2Client, DescribeImagesCommand } = require('@aws-sdk/client-ec2');

class DebianAMIFinder {
    constructor() {
        this.ec2Client = new EC2Client({
            region: process.env.AWS_REGION || 'eu-central-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                sessionToken: process.env.AWS_SESSION_TOKEN
            }
        });
    }

    async findDebian13AMI() {
        console.log('🔍 Searching for Debian 13 (Trixie) AMIs in eu-central-1...');

        try {
            const command = new DescribeImagesCommand({
                Owners: ['amazon'], // Only official AWS AMIs (no marketplace)
                Filters: [
                    {
                        Name: 'name',
                        Values: ['debian-13-amd64-*'] // Debian 13 Trixie pattern
                    },
                    {
                        Name: 'architecture',
                        Values: ['x86_64']
                    },
                    {
                        Name: 'root-device-type',
                        Values: ['ebs']
                    },
                    {
                        Name: 'virtualization-type',
                        Values: ['hvm']
                    },
                    {
                        Name: 'state',
                        Values: ['available']
                    }
                ]
            });

            const response = await this.ec2Client.send(command);

            if (response.Images && response.Images.length > 0) {
                // Sort by creation date (newest first)
                const sortedImages = response.Images.sort((a, b) =>
                    new Date(b.CreationDate) - new Date(a.CreationDate)
                );

                console.log('\n📋 Found Debian 13 AMIs:');
                console.log('='.repeat(80));

                sortedImages.slice(0, 5).forEach((image, index) => {
                    console.log(`${index + 1}. AMI ID: ${image.ImageId}`);
                    console.log(`   Name: ${image.Name}`);
                    console.log(`   Created: ${new Date(image.CreationDate).toLocaleString()}`);
                    console.log(`   Description: ${image.Description || 'N/A'}`);
                    console.log('');
                });

                console.log(`🎯 RECOMMENDED AMI ID: ${sortedImages[0].ImageId}`);
                console.log(`\n💡 Update your create-aws-instance.js script with:`);
                console.log(`   const amiId = '${sortedImages[0].ImageId}';`);

                return sortedImages[0].ImageId;
            } else {
                console.log('❌ No Debian 13 AMIs found. Let me try a broader search...');
                return await this.findDebianAMI();
            }

        } catch (error) {
            console.error(`❌ Error searching for AMIs: ${error.message}`);
            throw error;
        }
    }

    async findDebianAMI() {
        console.log('🔍 Searching for any recent Debian AMIs...');

        const command = new DescribeImagesCommand({
            Owners: ['amazon', 'aws-marketplace'],
            Filters: [
                {
                    Name: 'name',
                    Values: ['debian-*']
                },
                {
                    Name: 'architecture',
                    Values: ['x86_64']
                },
                {
                    Name: 'state',
                    Values: ['available']
                }
            ]
        });

        const response = await this.ec2Client.send(command);

        if (response.Images && response.Images.length > 0) {
            const sortedImages = response.Images.sort((a, b) =>
                new Date(b.CreationDate) - new Date(a.CreationDate)
            );

            console.log('\n📋 Recent Debian AMIs:');
            console.log('='.repeat(80));

            sortedImages.slice(0, 10).forEach((image, index) => {
                console.log(`${index + 1}. AMI ID: ${image.ImageId}`);
                console.log(`   Name: ${image.Name}`);
                console.log(`   Created: ${new Date(image.CreationDate).toLocaleString()}`);
                console.log('');
            });

            return sortedImages[0].ImageId;
        } else {
            throw new Error('No Debian AMIs found');
        }
    }
}

// Run the finder if this file is executed directly
if (require.main === module) {
    const finder = new DebianAMIFinder();
    finder.findDebian13AMI().catch(console.error);
}

module.exports = DebianAMIFinder;
