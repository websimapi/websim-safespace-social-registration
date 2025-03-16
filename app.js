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
    
    console.log(`Showing step ${step}`); // Add debugging log
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
        
        // Check network matches the configured network
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const network = await provider.getNetwork();
        const expectedNetwork = getExpectedNetworkId(config.network);
        
        if (network.chainId !== expectedNetwork) {
            alert(`Please switch to ${config.network} network in your wallet to continue.`);
            connectButton.textContent = 'Connect Wallet';
            return;
        }
        
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
        
        // Listen for network changes
        window.ethereum.on('chainChanged', (_chainId) => {
            // Handle the new chain
            // We recommend reloading the page unless you have good reason not to
            window.location.reload();
        });
        
    } catch (error) {
        console.error('Error connecting wallet:', error);
        connectButton.textContent = 'Connect Wallet';
        alert('Failed to connect wallet. Please try again.');
    }
}

// Send payment
async function sendPayment() {
    const sendButton = document.getElementById('send-payment');
    try {
        sendButton.textContent = 'Sending...';
        sendButton.disabled = true;
        
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        
        // Get current network
        const network = await provider.getNetwork();
        const expectedNetwork = getExpectedNetworkId(config.network);
        
        if (network.chainId !== expectedNetwork) {
            alert(`Please switch to ${config.network} network in your wallet to continue.`);
            sendButton.textContent = 'Send Payment';
            sendButton.disabled = false;
            return;
        }
        
        // Verify recipient address is valid
        if (!ethers.utils.isAddress(config.recipientAddress)) {
            alert('Invalid recipient address. Please check configuration.');
            sendButton.textContent = 'Send Payment';
            sendButton.disabled = false;
            return;
        }
        
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
        
        // Add link to transaction on block explorer
        const blockExplorerUrl = getBlockExplorerUrl(config.network, tx.hash);
        document.getElementById('tx-link').href = blockExplorerUrl;
        document.getElementById('tx-link').style.display = 'inline';
        
        // Begin verification process
        verifyTransaction(tx.hash);
        
    } catch (error) {
        console.error('Error sending payment:', error);
        sendButton.textContent = 'Send Payment';
        sendButton.disabled = false;
        alert(`Failed to send payment: ${error.message}`);
    }
}

// Get block explorer URL based on network and transaction hash
function getBlockExplorerUrl(network, txHash) {
    const baseUrl = network === 'mainnet' 
        ? 'https://etherscan.io' 
        : `https://${network}.etherscan.io`;
    return `${baseUrl}/tx/${txHash}`;
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
        showVerificationFailed(error.message);
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
            
            if (receipt) {
                if (receipt.status === 1) {
                    // Get transaction details for confirmation
                    const tx = await provider.getTransaction(txHash);
                    const block = await provider.getBlock(receipt.blockNumber);
                    
                    // Show confirmation time in UI
                    if (block) {
                        const confirmationTime = new Date(block.timestamp * 1000).toLocaleString();
                        document.getElementById('confirmation-time').textContent = confirmationTime;
                        document.getElementById('confirmation-time-container').style.display = 'block';
                    }
                    
                    showVerificationSuccess();
                    return true;
                } else if (receipt.status === 0) {
                    // Transaction failed on-chain
                    showVerificationFailed('Transaction failed on the blockchain. It may have run out of gas or encountered an error.');
                    return true; // We got a definitive answer, so return true
                }
            }
            
            // Update waiting message with attempt count
            const waitingElement = document.getElementById('verification-waiting');
            waitingElement.textContent = `Waiting for confirmation... (${attempts + 1}/${maxAttempts})`;
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
        }
        
        // If we exit the loop without returning, verification timed out
        showVerificationFailed('Verification timed out. The transaction may still be pending.');
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
            
            // Update waiting message with attempt count
            const waitingElement = document.getElementById('verification-waiting');
            waitingElement.textContent = `Waiting for confirmation via Etherscan... (${attempts + 1}/${maxAttempts})`;
            
            if (data.result && data.result.status === "1") {
                // Also get transaction timestamp if possible
                try {
                    const txInfoUrl = `https://${networkSubdomain}.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${config.etherscanApiKey}`;
                    const txInfoResponse = await fetch(txInfoUrl);
                    const txInfoData = await txInfoResponse.json();
                    
                    if (txInfoData.result && txInfoData.result.blockNumber) {
                        const blockNumber = parseInt(txInfoData.result.blockNumber, 16);
                        const blockUrl = `https://${networkSubdomain}.etherscan.io/api?module=block&action=getblockreward&blockno=${blockNumber}&apikey=${config.etherscanApiKey}`;
                        const blockResponse = await fetch(blockUrl);
                        const blockData = await blockResponse.json();
                        
                        if (blockData.result && blockData.result.timeStamp) {
                            const confirmationTime = new Date(parseInt(blockData.result.timeStamp) * 1000).toLocaleString();
                            document.getElementById('confirmation-time').textContent = confirmationTime;
                            document.getElementById('confirmation-time-container').style.display = 'block';
                        }
                    }
                } catch (err) {
                    console.error('Error getting transaction timestamp:', err);
                }
                
                showVerificationSuccess();
                return;
            } else if (data.result && data.result.status === "0") {
                showVerificationFailed('Transaction failed on the blockchain. It may have run out of gas or encountered an error.');
                return;
            }
            
            // Wait 4 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 4000));
            attempts++;
        }
        
        // If we exit the loop without returning, verification timed out
        showVerificationFailed('Verification timed out. The transaction may still be pending.');
    } catch (error) {
        console.error('Error checking transaction with Etherscan:', error);
        showVerificationFailed(`Etherscan API error: ${error.message}`);
    }
}

// Get expected network ID based on network name
function getExpectedNetworkId(networkName) {
    const networkMap = {
        'mainnet': 1,
        'goerli': 5,
        'sepolia': 11155111
    };
    return networkMap[networkName] || 1; // Default to mainnet if network not found
}

// Show verification success UI
function showVerificationSuccess() {
    document.getElementById('verification-pending').style.display = 'none';
    document.getElementById('verification-failed').style.display = 'none';
    document.getElementById('verification-success').style.display = 'block';
}

// Show verification failed UI
function showVerificationFailed(errorMessage = 'Unknown error occurred') {
    document.getElementById('verification-pending').style.display = 'none';
    document.getElementById('verification-success').style.display = 'none';
    document.getElementById('verification-failed').style.display = 'block';
    document.getElementById('error-message').textContent = errorMessage;
}

// Document ready function
document.addEventListener('DOMContentLoaded', () => {
    // Load configuration
    loadConfig();
    
    // Step 1: Account form submission
    const accountForm = document.getElementById('account-form');
    console.log('Account form element:', accountForm); // Add debugging log
    
    if (accountForm) {
        accountForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('Form submitted, moving to step 2'); // Add debugging log
            showStep(2);
        });
    } else {
        console.error('Account form element not found!');
    }
    
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