const { ipcRenderer } = require('electron');

// DOM Elements
const elements = {
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    username: document.getElementById('username'),
    passphrase: document.getElementById('passphrase'),
    privateKeyPath: document.getElementById('privateKeyPath'),
    selectPemBtn: document.getElementById('selectPemBtn'),
    installNodejs: document.getElementById('installNodejs'),
    installNginx: document.getElementById('installNginx'),
    installBasicTools: document.getElementById('installBasicTools'),
    installLetsEncrypt: document.getElementById('installLetsEncrypt'),
    installStaticWebsite: document.getElementById('installStaticWebsite'),
    sslDomain: document.getElementById('sslDomain'),
    sslEmail: document.getElementById('sslEmail'),
    letsEncryptConfig: document.getElementById('letsEncryptConfig'),
    staticWebsiteConfig: document.getElementById('staticWebsiteConfig'),
    staticDomain: document.getElementById('staticDomain'),
    staticZipPath: document.getElementById('staticZipPath'),
    selectStaticZipBtn: document.getElementById('selectStaticZipBtn'),
    checkBtn: document.getElementById('checkBtn'),
    installBtn: document.getElementById('installBtn'),
    statusArea: document.getElementById('statusArea'),
    alertArea: document.getElementById('alertArea'),
    resultArea: document.getElementById('resultArea'),
    logArea: document.getElementById('logArea'),
    logContent: document.getElementById('logContent')
};

// State management
let currentOperation = null;
let logBuffer = [];

// Utility functions
function disableButton(button) {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>' + button.textContent.trim();
}

function enableButton(button) {
    button.disabled = false;
    // Remove spinner icon if present
    const spinnerIcon = button.querySelector('.fa-spinner');
    if (spinnerIcon) {
        spinnerIcon.remove();
    }
}

function showAlert(type, message) {
    const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
    const iconClass = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle';

    elements.alertArea.innerHTML = `
        <div class="alert ${alertClass} d-flex align-items-center" role="alert">
            <i class="fas ${iconClass} me-2"></i>
            <div>${message}</div>
        </div>
    `;
    elements.statusArea.style.display = 'block';
}

function showResult(result) {
    let html = '';

    if (result.installed) {
        html = `
            <div class="alert alert-success">
                <h6 class="alert-heading mb-2"><i class="fas fa-check-circle me-1"></i>Node.js is installed!</h6>
                <p class="mb-1"><strong>Node.js:</strong> ${result.nodeVersion || 'Unknown'}</p>
                ${result.npmVersion ? `<p class="mb-0"><strong>npm:</strong> ${result.npmVersion}</p>` : ''}
            </div>
        `;
    } else {
        html = `
            <div class="alert alert-warning">
                <h6 class="alert-heading mb-2"><i class="fas fa-info-circle me-1"></i>Node.js not found</h6>
                <p class="mb-0">Node.js is not installed on the target system. Click "Install Node.js" to proceed.</p>
            </div>
        `;
    }

    elements.resultArea.innerHTML = html;
    elements.statusArea.style.display = 'block';
}

function showCheckResults(results) {
    let html = '';

    // Node.js results
    if (results.nodejs !== null) {
        if (results.nodejs.installed) {
            html += `
                <div class="alert alert-success mb-2">
                    <h6 class="alert-heading mb-1"><i class="fab fa-node-js me-1"></i>Node.js is installed!</h6>
                    <p class="mb-0"><strong>Node.js:</strong> ${results.nodejs.nodeVersion || 'Unknown'}</p>
                    ${results.nodejs.npmVersion ? `<p class="mb-0"><strong>npm:</strong> ${results.nodejs.npmVersion}</p>` : ''}
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-warning mb-2">
                    <h6 class="alert-heading mb-1"><i class="fab fa-node-js me-1"></i>Node.js not found</h6>
                    <p class="mb-0">Node.js is not installed on the target system.</p>
                </div>
            `;
        }
    }

    // Nginx results
    if (results.nginx !== null) {
        if (results.nginx.installed) {
            const runningIcon = results.nginx.running ?
                '<i class="fas fa-play-circle text-success me-1"></i>' :
                '<i class="fas fa-stop-circle text-warning me-1"></i>';
            const runningText = results.nginx.running ? 'Running' : 'Stopped';
            const alertClass = results.nginx.running ? 'alert-success' : 'alert-warning';

            const startButton = results.nginx.running ? '' : `
                <button type="button" class="btn btn-sm btn-success mt-2" id="startNginxBtn">
                    <i class="fas fa-play me-1"></i>Start Nginx
                </button>
            `;

            html += `
                <div class="alert ${alertClass} mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-server me-1"></i>Nginx is installed!</h6>
                    <p class="mb-1"><strong>Nginx:</strong> ${results.nginx.version || 'Unknown'}</p>
                    <p class="mb-0"><strong>Status:</strong> ${runningIcon}${runningText}</p>
                    ${startButton}
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-warning mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-server me-1"></i>Nginx not found</h6>
                    <p class="mb-0">Nginx is not installed on the target system.</p>
                </div>
            `;
        }
    }

    // Basic Tools results
    if (results.basicTools !== null) {
        const { installed, missing, allInstalled } = results.basicTools;
        if (allInstalled) {
            html += `
                <div class="alert alert-success mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-tools me-1"></i>All basic tools are installed!</h6>
                    <p class="mb-0"><strong>Installed:</strong> ${installed.join(', ')}</p>
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-warning mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-tools me-1"></i>Some basic tools are missing</h6>
                    <p class="mb-1"><strong>Installed:</strong> ${installed.join(', ')}</p>
                    <p class="mb-0"><strong>Missing:</strong> ${missing.join(', ')}</p>
                </div>
            `;
        }
    }

    // SSL results
    if (results.ssl !== null) {
        const { installed, valid, message } = results.ssl;
        if (installed && valid) {
            html += `
                <div class="alert alert-success mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-shield-alt me-1"></i>SSL Certificate is valid!</h6>
                    <p class="mb-0">${message}</p>
                </div>
            `;
        } else if (installed && !valid) {
            html += `
                <div class="alert alert-warning mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-shield-alt me-1"></i>SSL Certificate needs attention</h6>
                    <p class="mb-0">${message}</p>
                </div>
            `;
        } else {
            html += `
                <div class="alert alert-warning mb-2">
                    <h6 class="alert-heading mb-1"><i class="fas fa-shield-alt me-1"></i>SSL Certificate not found</h6>
                    <p class="mb-0">${message}</p>
                </div>
            `;
        }
    }

    elements.resultArea.innerHTML = html;
    elements.statusArea.style.display = 'block';

    // Add event listener for start nginx button if it exists
    const startNginxBtn = document.getElementById('startNginxBtn');
    if (startNginxBtn) {
        startNginxBtn.addEventListener('click', async () => {
            const config = getFormData();
            disableButton(startNginxBtn);
            startNginxBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting...';

            try {
                const result = await ipcRenderer.invoke('start-nginx', config);
                if (result.success) {
                    showAlert('success', 'Nginx service started successfully!');
                    // Optionally refresh the check results
                    setTimeout(() => {
                        // Re-run check to update status
                        if (!currentOperation) {
                            elements.checkBtn.click();
                        }
                    }, 1000);
                } else {
                    showAlert('danger', `Failed to start Nginx: ${result.error}`);
                }
            } catch (error) {
                showAlert('danger', `Error starting Nginx: ${error.message}`);
            } finally {
                enableButton(startNginxBtn);
                startNginxBtn.innerHTML = '<i class="fas fa-play me-1"></i>Start Nginx';
            }
        });
    }
}

function clearResults() {
    elements.alertArea.innerHTML = '';
    elements.resultArea.innerHTML = '';
    elements.statusArea.style.display = 'none';
    elements.logContent.innerHTML = '';
    elements.logArea.style.display = 'none';
    logBuffer = [];
}

function addLog(message) {
    logBuffer.push(message);
    elements.logContent.textContent = logBuffer.join('\n');
    elements.logArea.style.display = 'block';

    // Auto-scroll to bottom
    elements.logContent.scrollTop = elements.logContent.scrollHeight;
}

function validateForm() {
    const required = ['host', 'port', 'username', 'privateKeyPath'];

    for (const field of required) {
        const element = elements[field];
        if (!element.value.trim()) {
            showAlert('danger', `Please fill in the ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} field.`);
            element.focus();
            return false;
        }
    }

    // Validate IP/host format
    const hostValue = elements.host.value.trim();
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

    if (!ipRegex.test(hostValue)) {
        showAlert('danger', 'Please enter a valid IP address or hostname.');
        elements.host.focus();
        return false;
    }

    // Validate SSL configuration if Let's Encrypt is selected
    if (elements.installLetsEncrypt.checked) {
        if (!elements.sslDomain.value.trim()) {
            showAlert('danger', 'Please enter a domain name for SSL certificate.');
            elements.sslDomain.focus();
            return false;
        }

        if (!elements.sslEmail.value.trim()) {
            showAlert('danger', 'Please enter an email address for SSL certificate.');
            elements.sslEmail.focus();
            return false;
        }

        // Basic domain validation
        const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
        if (!domainRegex.test(elements.sslDomain.value.trim())) {
            showAlert('danger', 'Please enter a valid domain name.');
            elements.sslDomain.focus();
            return false;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(elements.sslEmail.value.trim())) {
            showAlert('danger', 'Please enter a valid email address.');
            elements.sslEmail.focus();
            return false;
        }
    }

    // Validate Static Website configuration if selected
    if (elements.installStaticWebsite.checked) {
        if (!elements.staticDomain.value.trim()) {
            showAlert('danger', 'Please enter a domain name for the static website.');
            elements.staticDomain.focus();
            return false;
        }

        if (!elements.staticZipPath.value.trim()) {
            showAlert('danger', 'Please select a ZIP file for the static website.');
            return false;
        }

        // Basic domain validation
        const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?$/;
        if (!domainRegex.test(elements.staticDomain.value.trim())) {
            showAlert('danger', 'Please enter a valid domain name for the static website.');
            elements.staticDomain.focus();
            return false;
        }

        // Check if ZIP file exists
        const fs = require('fs');
        if (!fs.existsSync(elements.staticZipPath.value.trim())) {
            showAlert('danger', 'The selected ZIP file does not exist.');
            return false;
        }
    }

    return true;
}

function getFormData() {
    return {
        host: elements.host.value.trim(),
        port: elements.port.value,
        username: elements.username.value.trim(),
        privateKeyPath: elements.privateKeyPath.value.trim(),
        passphrase: elements.passphrase.value.trim() || undefined,
        installOptions: {
            nodejs: elements.installNodejs.checked,
            nginx: elements.installNginx.checked,
            basicTools: elements.installBasicTools.checked,
            letsEncrypt: elements.installLetsEncrypt.checked,
            staticWebsite: elements.installStaticWebsite.checked
        },
        sslConfig: {
            domain: elements.sslDomain.value.trim(),
            email: elements.sslEmail.value.trim()
        },
        staticWebsiteConfig: {
            domain: elements.staticDomain.value.trim(),
            zipFilePath: elements.staticZipPath.value.trim()
        }
    };
}

// Event listeners
elements.selectPemBtn.addEventListener('click', async () => {
    try {
        // Show loading state
        const originalText = elements.selectPemBtn.innerHTML;
        elements.selectPemBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Selecting...';
        elements.selectPemBtn.disabled = true;

        const filePath = await ipcRenderer.invoke('select-pem-file');
        if (filePath) {
            elements.privateKeyPath.value = filePath;
            // Show success message if file was selected
            showAlert('success', 'SSH key file selected successfully!');
        }
    } catch (error) {
        console.error('Error selecting file:', error);
        showAlert('danger', 'Error selecting SSH key file.');
    } finally {
        // Restore button state
        elements.selectPemBtn.innerHTML = '<i class="fas fa-folder-open"></i>';
        elements.selectPemBtn.disabled = false;
    }
});

// ZIP file selection handler
elements.selectStaticZipBtn.addEventListener('click', async () => {
    try {
        // Show loading state
        const originalText = elements.selectStaticZipBtn.innerHTML;
        elements.selectStaticZipBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Selecting...';
        elements.selectStaticZipBtn.disabled = true;

        // Use IPC to communicate with main process
        const filePath = await ipcRenderer.invoke('select-zip-file');
        if (filePath) {
            elements.staticZipPath.value = filePath;
            // Show success message if file was selected
            showAlert('success', 'ZIP file selected successfully!');
        }
    } catch (error) {
        console.error('Error selecting ZIP file:', error);
        showAlert('danger', 'Error selecting ZIP file.');
    } finally {
        // Restore button state
        elements.selectStaticZipBtn.innerHTML = '<i class="fas fa-folder-open"></i>';
        elements.selectStaticZipBtn.disabled = false;
    }
});

elements.checkBtn.addEventListener('click', async () => {
    if (!validateForm()) return;

    clearResults();
    currentOperation = 'check';
    disableButton(elements.checkBtn);

    const config = getFormData();
    const selectedOptions = Object.keys(config.installOptions).filter(key => config.installOptions[key]);

    if (selectedOptions.length === 0) {
        showAlert('danger', 'Please select at least one component to check.');
        enableButton(elements.checkBtn);
        currentOperation = null;
        return;
    }

    // Include SSL in the log if selected
    const logOptions = [...selectedOptions];
    if (config.installOptions.letsEncrypt) {
        logOptions.push('SSL');
    }
    addLog(`🔍 Checking status of: ${logOptions.join(', ')}...`);

    try {
        const result = await ipcRenderer.invoke('check-selected', config);

        if (result.success) {
            addLog('✅ Status check completed successfully');
            showCheckResults(result.results);
        } else {
            addLog(`❌ Check failed: ${result.error}`);
            showAlert('danger', `Check failed: ${result.error}`);
        }
    } catch (error) {
        addLog(`❌ Error during check: ${error.message}`);
        showAlert('danger', `Error during check: ${error.message}`);
    } finally {
        enableButton(elements.checkBtn);
        currentOperation = null;
    }
});

elements.installBtn.addEventListener('click', async () => {
    if (!validateForm()) return;

    clearResults();
    currentOperation = 'install';
    disableButton(elements.installBtn);

    const config = getFormData();
    const selectedOptions = Object.keys(config.installOptions).filter(key => config.installOptions[key]);

    if (selectedOptions.length === 0) {
        showAlert('danger', 'Please select at least one installation option.');
        enableButton(elements.installBtn);
        currentOperation = null;
        return;
    }

    // Include SSL in the log if selected
    const installLogOptions = [...selectedOptions];
    if (config.installOptions.letsEncrypt) {
        installLogOptions.push('SSL');
    }
    addLog(`🚀 Starting installation of: ${installLogOptions.join(', ')}...`);

    try {
        const result = await ipcRenderer.invoke('install-selected', config);

        if (result.success) {
            addLog('✅ Installation completed successfully');
            showAlert('success', 'Selected components have been successfully installed!');
        } else {
            addLog(`❌ Installation failed: ${result.error}`);
            showAlert('danger', `Installation failed: ${result.error}`);
        }
    } catch (error) {
        addLog(`❌ Error during installation: ${error.message}`);
        showAlert('danger', `Error during installation: ${error.message}`);
    } finally {
        enableButton(elements.installBtn);
        currentOperation = null;
    }
});

// Let's Encrypt checkbox handler
elements.installLetsEncrypt.addEventListener('change', () => {
    if (elements.installLetsEncrypt.checked) {
        elements.letsEncryptConfig.style.display = 'block';
        // Auto-enable nginx if Let's Encrypt is selected
        elements.installNginx.checked = true;
    } else {
        elements.letsEncryptConfig.style.display = 'none';
    }
});

// Nginx checkbox handler - disable Let's Encrypt if nginx is unchecked
elements.installNginx.addEventListener('change', () => {
    if (!elements.installNginx.checked && elements.installLetsEncrypt.checked) {
        elements.installLetsEncrypt.checked = false;
        elements.letsEncryptConfig.style.display = 'none';
    }
});

// Static Website checkbox handler
elements.installStaticWebsite.addEventListener('change', () => {
    if (elements.installStaticWebsite.checked) {
        elements.staticWebsiteConfig.style.display = 'block';
        // Auto-enable nginx and basic tools if Static Website is selected
        elements.installNginx.checked = true;
        elements.installBasicTools.checked = true;
    } else {
        elements.staticWebsiteConfig.style.display = 'none';
    }
});

// Nginx checkbox handler - disable Let's Encrypt and Static Website if nginx is unchecked
elements.installNginx.addEventListener('change', () => {
    if (!elements.installNginx.checked) {
        if (elements.installLetsEncrypt.checked) {
            elements.installLetsEncrypt.checked = false;
            elements.letsEncryptConfig.style.display = 'none';
        }
        if (elements.installStaticWebsite.checked) {
            elements.installStaticWebsite.checked = false;
            elements.staticWebsiteConfig.style.display = 'none';
        }
    }
});

// Basic Tools checkbox handler - disable Static Website if basic tools is unchecked
elements.installBasicTools.addEventListener('change', () => {
    if (!elements.installBasicTools.checked && elements.installStaticWebsite.checked) {
        elements.installStaticWebsite.checked = false;
        elements.staticWebsiteConfig.style.display = 'none';
    }
});

// Form validation feedback
['host', 'port', 'username', 'privateKeyPath'].forEach(field => {
    elements[field].addEventListener('input', () => {
        if (elements[field].value.trim()) {
            elements[field].classList.remove('is-invalid');
            elements[field].classList.add('is-valid');
        } else {
            elements[field].classList.remove('is-valid');
            elements[field].classList.add('is-invalid');
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
            case 'Enter':
                event.preventDefault();
                if (!currentOperation) {
                    if (event.shiftKey) {
                        elements.checkBtn.click();
                    } else {
                        elements.installBtn.click();
                    }
                }
                break;
        }
    }
});

// Listen for progress updates from main process
ipcRenderer.on('progress-update', (event, message) => {
    addLog(message);
});

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    console.log('Debian Node.js LTS Installer GUI loaded');
    addLog('Application started. Ready to check/install Node.js on Debian hosts.');
});
