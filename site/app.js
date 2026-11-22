// Browser wiring for the TEST/Sepolia staking site. Uses only StakingLib (lib.js)
// for encoding/parsing and talks to an injected wallet (window.ethereum) with raw
// JSON-RPC calls, so no runtime library needs to be bundled.
(function () {
  "use strict";

  var L = window.StakingLib;
  var EXPLORER = "https://sepolia.etherscan.io";
  var DECIMALS = 18; // read dynamically from the token at runtime; this is only the fallback

  var state = {
    deployment: null,
    account: null,
    chainIdHex: null,
    decimals: DECIMALS,
    tokenOk: false,
    stakingOk: false
  };

  var el = {};
  document.addEventListener("DOMContentLoaded", function () {
    el.walletStatus = document.getElementById("wallet-status");
    el.connectBtn = document.getElementById("connect-btn");
    el.switchBtn = document.getElementById("switch-chain-btn");
    el.deployStatus = document.getElementById("deploy-status");
    el.account = document.getElementById("account");
    el.balance = document.getElementById("balance");
    el.staked = document.getElementById("staked");
    el.poolShare = document.getElementById("pool-share");
    el.points = document.getElementById("points");
    el.faucetAmount = document.getElementById("faucet-amount");
    el.faucetBtn = document.getElementById("faucet-btn");
    el.stakeAmount = document.getElementById("stake-amount");
    el.stakeBtn = document.getElementById("stake-btn");
    el.withdrawAmount = document.getElementById("withdraw-amount");
    el.withdrawMaxBtn = document.getElementById("withdraw-max-btn");
    el.withdrawBtn = document.getElementById("withdraw-btn");
    el.activity = document.getElementById("activity-log");

    init();
  });

  function log(message, txHash, kind) {
    var item = document.createElement("li");
    item.className = "log-item" + (kind ? " log-" + kind : "");
    var text = document.createElement("span");
    text.textContent = message;
    item.appendChild(text);
    if (txHash) {
      var link = document.createElement("a");
      link.href = EXPLORER + "/tx/" + txHash;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "view tx";
      item.appendChild(document.createTextNode(" "));
      item.appendChild(link);
    }
    el.activity.insertBefore(item, el.activity.firstChild);
  }

  function setActionsEnabled(enabled) {
    [el.faucetBtn, el.stakeBtn, el.withdrawBtn, el.withdrawMaxBtn].forEach(function (btn) {
      if (btn) btn.disabled = !enabled;
    });
  }

  async function init() {
    setActionsEnabled(false);
    try {
      var res = await fetch("deployment.json", { cache: "no-store" });
      var data = await res.json();
      state.deployment = L.validateDeployment(data);
    } catch (e) {
      state.deployment = { valid: false, errors: ["could not load/parse deployment.json: " + e.message], token: null, staking: null, deployed: false };
    }
    renderDeploymentStatus();

    if (!window.ethereum) {
      el.walletStatus.textContent = "No browser wallet detected. Install one (e.g. MetaMask) to use this app.";
      el.connectBtn.disabled = true;
      return;
    }

    el.connectBtn.addEventListener("click", connectWallet);
    el.switchBtn.addEventListener("click", switchToSepolia);
    el.faucetBtn.addEventListener("click", onFaucet);
    el.stakeBtn.addEventListener("click", onStake);
    el.withdrawBtn.addEventListener("click", onWithdraw);
    el.withdrawMaxBtn.addEventListener("click", function () {
      el.withdrawAmount.value = lastKnownStakedDisplay;
    });

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", function () {
      window.location.reload();
    });

    try {
      var accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts && accounts.length > 0) {
        await handleAccountsChanged(accounts);
      } else {
        el.walletStatus.textContent = "Wallet detected. Click Connect to continue.";
      }
    } catch (e) {
      el.walletStatus.textContent = "Could not read wallet accounts: " + e.message;
    }
  }

  function renderDeploymentStatus() {
    var d = state.deployment;
    if (!d.valid) {
      el.deployStatus.textContent = "Deployment record invalid: " + d.errors.join("; ");
      el.deployStatus.className = "status status-error";
      setActionsEnabled(false);
      return;
    }
    if (!d.deployed) {
      el.deployStatus.textContent = "Not deployed yet.";
      el.deployStatus.className = "status status-pending";
      setActionsEnabled(false);
      return;
    }
    el.deployStatus.textContent = "Token: " + d.token + " | Staking: " + d.staking;
    el.deployStatus.className = "status status-ok";
  }

  async function connectWallet() {
    try {
      var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await handleAccountsChanged(accounts);
    } catch (e) {
      if (e && e.code === 4001) {
        el.walletStatus.textContent = "Connection request rejected.";
      } else {
        el.walletStatus.textContent = "Connection failed: " + e.message;
      }
    }
  }

  async function handleAccountsChanged(accounts) {
    if (!accounts || accounts.length === 0) {
      state.account = null;
      el.walletStatus.textContent = "Wallet disconnected.";
      el.account.textContent = "-";
      setActionsEnabled(false);
      return;
    }
    state.account = accounts[0];
    el.account.textContent = state.account;
    el.walletStatus.textContent = "Connected.";
    await checkChain();
  }

  async function checkChain() {
    var chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
    state.chainIdHex = chainIdHex;
    if (chainIdHex.toLowerCase() !== L.SEPOLIA_CHAIN_ID_HEX) {
      el.walletStatus.textContent = "Wrong network. Please switch to Sepolia.";
      el.switchBtn.hidden = false;
      setActionsEnabled(false);
      return;
    }
    el.switchBtn.hidden = true;
    await validateContracts();
  }

  async function switchToSepolia() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: L.SEPOLIA_CHAIN_ID_HEX }]
      });
    } catch (e) {
      if (e && e.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: L.SEPOLIA_CHAIN_ID_HEX,
              chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://rpc.sepolia.org"],
              blockExplorerUrls: [EXPLORER]
            }]
          });
        } catch (addErr) {
          el.walletStatus.textContent = "Could not add Sepolia: " + addErr.message;
          return;
        }
      } else if (e && e.code === 4001) {
        el.walletStatus.textContent = "Network switch rejected.";
        return;
      } else {
        el.walletStatus.textContent = "Could not switch network: " + e.message;
        return;
      }
    }
    await checkChain();
  }

  async function ethCall(to, data) {
    return window.ethereum.request({ method: "eth_call", params: [{ to: to, data: data }, "latest"] });
  }

  async function getCode(address) {
    return window.ethereum.request({ method: "eth_getCode", params: [address, "latest"] });
  }

  // Validates on-chain state before enabling any action: both addresses must hold
  // contract code, and the staking contract's token() must bind to the configured token.
  async function validateContracts() {
    var d = state.deployment;
    if (!d.deployed) {
      renderDeploymentStatus();
      return;
    }
    try {
      var tokenCode = await getCode(d.token);
      var stakingCode = await getCode(d.staking);
      state.tokenOk = tokenCode && tokenCode !== "0x";
      state.stakingOk = stakingCode && stakingCode !== "0x";
      if (!state.tokenOk || !state.stakingOk) {
        el.deployStatus.textContent = "Configured address has no contract code on Sepolia.";
        el.deployStatus.className = "status status-error";
        setActionsEnabled(false);
        return;
      }
      var boundTokenHex = await ethCall(d.staking, L.encodeCall("token()", []));
      var boundToken = L.decodeAddress(boundTokenHex);
      if (!boundToken || boundToken.toLowerCase() !== d.token.toLowerCase()) {
        el.deployStatus.textContent = "Staking contract is not bound to the configured token.";
        el.deployStatus.className = "status status-error";
        setActionsEnabled(false);
        return;
      }
      var decimalsHex = await ethCall(d.token, L.encodeCall("decimals()", []));
      state.decimals = Number(L.decodeUint256(decimalsHex));
      el.deployStatus.textContent = "Token: " + d.token + " | Staking: " + d.staking + " (validated)";
      el.deployStatus.className = "status status-ok";
      setActionsEnabled(true);
      await refresh();
    } catch (e) {
      el.deployStatus.textContent = "Contract validation failed: " + e.message;
      el.deployStatus.className = "status status-error";
      setActionsEnabled(false);
    }
  }

  var lastKnownStakedDisplay = "0";

  async function refresh() {
    var d = state.deployment;
    if (!state.account || !d.deployed || !state.tokenOk || !state.stakingOk) return;
    var addrArg = L.encodeAddressArg(state.account);
    var balanceHex = await ethCall(d.token, L.encodeCall("balanceOf(address)", [addrArg]));
    var stakedHex = await ethCall(d.staking, L.encodeCall("stakedOf(address)", [addrArg]));
    var totalStakedHex = await ethCall(d.staking, L.encodeCall("totalStaked()", []));
    var pointsHex = await ethCall(d.staking, L.encodeCall("pointsOf(address)", [addrArg]));

    var balance = L.decodeUint256(balanceHex);
    var staked = L.decodeUint256(stakedHex);
    var totalStaked = L.decodeUint256(totalStakedHex);
    var points = L.decodeUint256(pointsHex);

    el.balance.textContent = L.formatUnits(balance, state.decimals) + " TEST";
    el.staked.textContent = L.formatUnits(staked, state.decimals) + " TEST";
    lastKnownStakedDisplay = L.formatUnits(staked, state.decimals);
    el.points.textContent = L.formatUnits(points, 18);
    if (totalStaked === 0n) {
      el.poolShare.textContent = "0% (pool empty)";
    } else {
      var basisPoints = (staked * 10000n) / totalStaked;
      el.poolShare.textContent = (Number(basisPoints) / 100).toFixed(2) + "%";
    }
  }

  async function sendTx(to, data, label) {
    log(label + ": pending...", null, "pending");
    var txHash;
    try {
      txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: state.account, to: to, data: data }]
      });
    } catch (e) {
      if (e && e.code === 4001) {
        log(label + ": rejected by user.", null, "rejected");
      } else {
        log(label + ": failed to send - " + e.message, null, "rejected");
      }
      throw e;
    }
    log(label + ": submitted.", txHash, "pending");
    var receipt = await waitForReceipt(txHash);
    if (receipt.status === "0x0") {
      log(label + ": reverted on-chain.", txHash, "rejected");
      throw new Error("transaction reverted");
    }
    log(label + ": confirmed.", txHash, "success");
    return receipt;
  }

  function waitForReceipt(txHash) {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      var maxAttempts = 60; // ~2 minutes at 2s intervals, user-initiated only
      function poll() {
        attempts++;
        window.ethereum.request({ method: "eth_getTransactionReceipt", params: [txHash] })
          .then(function (receipt) {
            if (receipt) {
              resolve(receipt);
            } else if (attempts >= maxAttempts) {
              reject(new Error("timed out waiting for confirmation"));
            } else {
              setTimeout(poll, 2000);
            }
          })
          .catch(reject);
      }
      poll();
    });
  }

  async function onFaucet() {
    try {
      var amount = L.parseUnits(el.faucetAmount.value || "0", state.decimals);
      if (amount <= 0n) { log("Faucet: enter an amount greater than 0.", null, "rejected"); return; }
      var data = L.encodeCall("mint(uint256)", [L.encodeUint256Arg(amount)]);
      await sendTx(state.deployment.token, data, "Faucet mint");
      await refresh();
    } catch (e) {
      log("Faucet failed: " + e.message, null, "rejected");
    }
  }

  async function onStake() {
    try {
      var amount = L.parseUnits(el.stakeAmount.value || "0", state.decimals);
      if (amount <= 0n) { log("Stake: enter an amount greater than 0.", null, "rejected"); return; }

      var balanceHex = await ethCall(state.deployment.token, L.encodeCall("balanceOf(address)", [L.encodeAddressArg(state.account)]));
      var balance = L.decodeUint256(balanceHex);
      if (amount > balance) {
        log("Stake: amount exceeds your TEST balance.", null, "rejected");
        return;
      }

      var allowanceHex = await ethCall(state.deployment.token, L.encodeCall(
        "allowance(address,address)",
        [L.encodeAddressArg(state.account), L.encodeAddressArg(state.deployment.staking)]
      ));
      var allowance = L.decodeUint256(allowanceHex);
      if (allowance < amount) {
        var approveData = L.encodeCall("approve(address,uint256)", [
          L.encodeAddressArg(state.deployment.staking), L.encodeUint256Arg(amount)
        ]);
        await sendTx(state.deployment.token, approveData, "Approve " + L.formatUnits(amount, state.decimals) + " TEST");
        var recheckHex = await ethCall(state.deployment.token, L.encodeCall(
          "allowance(address,address)",
          [L.encodeAddressArg(state.account), L.encodeAddressArg(state.deployment.staking)]
        ));
        if (L.decodeUint256(recheckHex) < amount) {
          log("Stake: approval did not confirm with a sufficient allowance; aborting stake.", null, "rejected");
          return;
        }
      }

      var stakeData = L.encodeCall("stake(uint256)", [L.encodeUint256Arg(amount)]);
      await sendTx(state.deployment.staking, stakeData, "Stake " + L.formatUnits(amount, state.decimals) + " TEST");
      await refresh();
    } catch (e) {
      log("Stake failed: " + e.message, null, "rejected");
    }
  }

  async function onWithdraw() {
    try {
      var amount = L.parseUnits(el.withdrawAmount.value || "0", state.decimals);
      if (amount <= 0n) { log("Withdraw: enter an amount greater than 0.", null, "rejected"); return; }

      var stakedHex = await ethCall(state.deployment.staking, L.encodeCall("stakedOf(address)", [L.encodeAddressArg(state.account)]));
      var staked = L.decodeUint256(stakedHex);
      if (amount > staked) {
        log("Withdraw: amount exceeds your staked balance.", null, "rejected");
        return;
      }

      var data = L.encodeCall("withdraw(uint256)", [L.encodeUint256Arg(amount)]);
      await sendTx(state.deployment.staking, data, "Withdraw " + L.formatUnits(amount, state.decimals) + " TEST");
      await refresh();
    } catch (e) {
      log("Withdraw failed: " + e.message, null, "rejected");
    }
  }
})();
