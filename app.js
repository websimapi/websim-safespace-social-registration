import { ethers } from 'ethers';

// Configuration defaults
let config = {
    recipientAddress: '0x0000000000000000000000000000000000000000',
    etherscanApiKey: '',  // Optional
    network: 'mainnet',
    // Payment amount in ETH (equivalent to $1)
    paymentAmountEth: '0.0004' 
};

// Load configuration from localStorage if it exists
const loadConfig = () => {
    const savedConfig = localStorage.getItem('safespace-config');
    if (savedConfig) {
        config = { ...config, ...JSON.parse(savedConfig) };
    }
    
    // Update UI with loaded config
    document.getElementById('recipient-address').textContent = config.recipientAddress;
    document.getElementById('recipient-address-input').value = config.recipientAddress;
    document.getElementById('etherscan-api-key').value = config.etherscanApiKey;
    document.getElementById('network-select').value = config.network;
};

// Save configuration to localStorage
const saveConfig = () => {
    localStorage.setItem('safespace-config', JSON.stringify(config));
};

// Step navigation management
let currentStep = 1;

const showStep = (step) => {
    // Hide all steps
    document.querySelectorAll('.step-content').forEach(el => {
        el.classList.remove('active');
    });
    
    // Show the current step
    document.getElementById(`step${step}`).classList.add('active');
    
    // Update step indicators
    document.querySelectorAll('.step').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById(`step${step}-indicator`).classList.add('active');
    
    currentStep = step;
};

// Wallet connection
async function connectWallet() {
    const connectButton = document.getElementById('connect-wallet');
    const walletStatus = document.getElementById('wallet-status');
    const paymentDetails = document.querySelector('.payment-details');
    
    try {
        // Check if MetaMask is installed
        if (typeof window.ethereum === 'undefined') {
            alert('Please install MetaMask or another Web3 wallet extension to continue.');
            return;
        }
        
        connectButton.textContent = 'Connecting...';
        
        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const userAddress = accounts[0];
        
        // Update UI to show connected state
        walletStatus.textContent = `Connected: ${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
        walletStatus.classList.remove('not-connected');
        walletStatus.classList.add('connected');
        
        connectButton.textContent = 'Wallet Connected';
        connectButton.disabled = true;
        
        // Show payment details after wallet is connected
        paymentDetails.style.display = 'block';
        
        // Listen for account changes
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) {
                // User disconnected wallet
                walletStatus.textContent = 'Wallet not connected';
                walletStatus.classList.add('not-connected');
                walletStatus.classList.remove('connected');
                connectButton.textContent = 'Connect Wallet';
                connectButton.disabled = false;
                paymentDetails.style.display = 'none';
            } else {
                // User switched accounts
                const newAddress = accounts[0];
                walletStatus.textContent = `Connected: ${newAddress.substring(0, 6)}...${newAddress.substring(38)}`;
            }
        });
        
    } catch (error) {
        console.error('Error connecting wallet:', error);
        connectButton.textContent = 'Connect Wallet';
        alert('Failed to connect wallet. Please try again.');
    }
}

// Send payment
async function sendPayment() {
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        
        // Create transaction
        const tx = await signer.sendTransaction({
            to: config.recipientAddress,
            value: ethers.utils.parseEther(config.paymentAmountEth) // Convert ETH to Wei
        });
        
        console.log("Transaction sent:", tx.hash);
        
        // Move to verification step
        showStep(3);
        
        // Show transaction hash
        document.getElementById('tx-hash').textContent = tx.hash;
        
        // Begin verification process
        verifyTransaction(tx.hash);
        
    } catch (error) {
        console.error('Error sending payment:', error);
        alert('Failed to send payment. Please try again.');
    }
}

// Verify transaction
async function verifyTransaction(txHash) {
    try {
        // First try the ethers.js provider approach
        const verificationSuccessful = await checkTransactionWithProvider(txHash);
        
        if (!verificationSuccessful && config.etherscanApiKey) {
            // If the first method fails and we have an API key, try Etherscan
            await checkTransactionWithEtherscan(txHash);
        }
    } catch (error) {
        console.error('Error verifying transaction:', error);
        showVerificationFailed();
    }
}

// Check transaction using ethers.js
async function checkTransactionWithProvider(txHash) {
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        
        // Wait for transaction to be mined (with timeout)
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts × 2 seconds = 1 minute max wait
        
        while (attempts < maxAttempts) {
            const receipt = await provider.getTransactionReceipt(txHash);
            
            if (receipt && receipt.status === 1) {
                showVerificationSuccess();
                return true;
            } else if (receipt && receipt.status === 0) {
                // Transaction failed on-chain
                showVerificationFailed();
                return true; // We got a definitive answer, so return true
            }
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
        }
        
        // If we exit the loop without returning, verification timed out
        return false;
    } catch (error) {
        console.error('Error checking transaction with provider:', error);
        return false;
    }
}

// Check transaction using Etherscan API
async function checkTransactionWithEtherscan(txHash) {
    try {
        const networkSubdomain = config.network === 'mainnet' ? 'api' : `api-${config.network}`;
        const apiUrl = `https://${networkSubdomain}.etherscan.io/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${config.etherscanApiKey}`;
        
        let attempts = 0;
        const maxAttempts = 15; // 15 attempts × 4 seconds = 1 minute max wait
        
        while (attempts < maxAttempts) {
            const response = await fetch(apiUrl);
            const data = await response.json();
            
            if (data.result && data.result.status === "1") {
                showVerificationSuccess();
                return;
            } else if (data.result && data.result.status === "0") {
                showVerificationFailed();
                return;
            }
            
            // Wait 4 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 4000));
            attempts++;
        }
        
        // If we exit the loop without returning, verification timed out
        showVerificationFailed();
    } catch (error) {
        console.error('Error checking transaction with Etherscan:', error);
        showVerificationFailed();
    }
}

// Show verification success UI
function showVerificationSuccess() {
    document.getElementById('verification-pending').style.display = 'none';
    document.getElementById('verification-failed').style.display = 'none';
    document.getElementById('verification-success').style.display = 'block';
}

// Show verification failed UI
function showVerificationFailed() {
    document.getElementById('verification-pending').style.display = 'none';
    document.getElementById('verification-success').style.display = 'none';
    document.getElementById('verification-failed').style.display = 'block';
}

// Document ready function
document.addEventListener('DOMContentLoaded', () => {
    // Load configuration
    loadConfig();
    
    // Step 1: Account form submission
    document.getElementById('account-form').addEventListener('submit', (e) => {
        e.preventDefault();
        showStep(2);
    });
    
    // Step 2: Back to step 1
    document.getElementById('back-to-step1').addEventListener('click', () => {
        showStep(1);
    });
    
    // Connect wallet
    document.getElementById('connect-wallet').addEventListener('click', connectWallet);
    
    // Send payment
    document.getElementById('send-payment').addEventListener('click', sendPayment);
    
    // Retry payment
    document.getElementById('retry-payment').addEventListener('click', () => {
        showStep(2);
    });
    
    // Complete registration
    document.getElementById('complete-registration').addEventListener('click', () => {
        alert('Registration completed successfully! Redirecting to dashboard...');
        setTimeout(() => {
            // In a real app, you would redirect to the dashboard or home page
            window.location.reload();
        }, 1500);
    });
    
    // Configuration modal
    const modal = document.getElementById('config-modal');
    const configBtn = document.getElementById('config-address-btn');
    const closeBtn = document.querySelector('.close');
    
    configBtn.addEventListener('click', () => {
        modal.style.display = 'block';
    });
    
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Configuration form submission
    document.getElementById('config-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        config.recipientAddress = document.getElementById('recipient-address-input').value;
        config.etherscanApiKey = document.getElementById('etherscan-api-key').value;
        config.network = document.getElementById('network-select').value;
        
        // Update UI
        document.getElementById('recipient-address').textContent = config.recipientAddress;
        
        // Save configuration
        saveConfig();
        
        // Close modal
        modal.style.display = 'none';
    });
});

