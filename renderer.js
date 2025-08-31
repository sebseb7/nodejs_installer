const { ipcRenderer } = require('electron');

// DOM Elements
const elements = {
    host: document.getElementById('host'),
    port: document.getElementById('port'),
    username: document.getElementById('username'),
    passphrase: document.getElementById('passphrase'),
    privateKeyPath: document.getElementById('privateKeyPath'),
    selectPemBtn: document.getElementById('selectPemBtn'),
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

    return true;
}

function getFormData() {
    return {
        host: elements.host.value.trim(),
        port: elements.port.value,
        username: elements.username.value.trim(),
        privateKeyPath: elements.privateKeyPath.value.trim(),
        passphrase: elements.passphrase.value.trim() || undefined
    };
}

// Event listeners
elements.selectPemBtn.addEventListener('click', async () => {
    try {
        const filePath = await ipcRenderer.invoke('select-pem-file');
        if (filePath) {
            elements.privateKeyPath.value = filePath;
        }
    } catch (error) {
        console.error('Error selecting file:', error);
        showAlert('danger', 'Error selecting PEM file.');
    }
});

elements.checkBtn.addEventListener('click', async () => {
    if (!validateForm()) return;

    clearResults();
    currentOperation = 'check';
    disableButton(elements.checkBtn);

    addLog('🔍 Starting Node.js check...');

    try {
        const config = getFormData();
        const result = await ipcRenderer.invoke('check-nodejs', config);

        if (result.success) {
            addLog('✅ Node.js check completed successfully');
            showResult(result.result);
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

    addLog('🚀 Starting Node.js installation...');

    try {
        const config = getFormData();
        const result = await ipcRenderer.invoke('install-nodejs', config);

        if (result.success) {
            addLog('✅ Node.js installation completed successfully');
            showResult(result.result);
            showAlert('success', 'Node.js LTS has been successfully installed!');
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
