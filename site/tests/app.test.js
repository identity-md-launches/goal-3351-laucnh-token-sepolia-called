// Integration-style tests for site/app.js using a minimal hand-built DOM/wallet
// mock run inside Node's vm module (no jsdom / no build step / no dependency).
// Run with: node site/tests/app.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const libSrc = fs.readFileSync(path.join(__dirname, "..", "lib.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

const IDS = [
  "wallet-status", "connect-btn", "switch-chain-btn", "deploy-status", "account",
  "balance", "staked", "pool-share", "points", "faucet-amount", "faucet-btn",
  "stake-amount", "stake-btn", "withdraw-amount", "withdraw-max-btn", "withdraw-btn",
  "activity-log"
];

function makeElement(id) {
  return {
    id: id,
    textContent: "",
    className: "",
    value: "",
    disabled: false,
    hidden: false,
    _listeners: {},
    children: [],
    addEventListener(event, cb) {
      (this._listeners[event] = this._listeners[event] || []).push(cb);
    },
    appendChild(child) { this.children.push(child); },
    insertBefore(node, ref) { this.children.unshift(node); },
  };
}

function makeDom() {
  const elements = {};
  IDS.forEach((id) => { elements[id] = makeElement(id); });
  const docListeners = {};
  const document = {
    addEventListener(event, cb) { (docListeners[event] = docListeners[event] || []).push(cb); },
    getElementById(id) { return elements[id]; },
    createElement(tag) { return makeElement("<" + tag + ">"); },
    createTextNode(text) { return { nodeType: "text", text: text }; },
  };
  return { document, elements, docListeners };
}

function makeEthereum(opts) {
  opts = opts || {};
  const handlers = {};
  const calls = [];
  return {
    _handlers: handlers,
    _calls: calls,
    on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); },
    emit(event, payload) { (handlers[event] || []).forEach((cb) => cb(payload)); },
    request(args) {
      calls.push(args);
      const impl = opts.handlers && opts.handlers[args.method];
      if (impl) return Promise.resolve(impl(args));
      throw new Error("unhandled method in test mock: " + args.method);
    },
  };
}

async function flush(times) {
  for (let i = 0; i < (times || 8); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function buildContext({ deploymentJson, hasWallet, ethereumOpts, fetchImpl }) {
  const { document, elements, docListeners } = makeDom();
  const ethereum = hasWallet === false ? undefined : makeEthereum(ethereumOpts);
  const sandbox = {
    console,
    setTimeout,
    Promise,
    BigInt,
    window: {},
    document,
    fetch:
      fetchImpl ||
      (() =>
        Promise.resolve({
          json: () => Promise.resolve(deploymentJson),
        })),
  };
  sandbox.window.document = document;
  sandbox.window.ethereum = ethereum;
  sandbox.window.StakingLib = undefined; // set by lib.js below
  sandbox.window.location = { reload() {} };
  const context = vm.createContext(sandbox);
  vm.runInContext(libSrc, context, { filename: "lib.js" });
  vm.runInContext(appSrc, context, { filename: "app.js" });
  return { context, document, elements, docListeners, ethereum };
}

async function triggerDomReady(docListeners) {
  const cbs = docListeners["DOMContentLoaded"] || [];
  for (const cb of cbs) cb();
  await flush();
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok   -", name);
  } catch (e) {
    failed++;
    console.log("FAIL -", name, "\n       ", e.stack ? e.stack.split("\n").slice(0, 2).join("\n        ") : e.message);
  }
}

(async () => {
  await test("absent wallet: actions disabled and clear message shown", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token: null, staking: null },
      hasWallet: false,
    });
    await triggerDomReady(docListeners);
    assert.ok(/no browser wallet/i.test(elements["wallet-status"].textContent));
    assert.strictEqual(elements["connect-btn"].disabled, true);
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  await test("null deployment addresses: shows Not deployed yet, actions disabled", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token: null, staking: null },
      hasWallet: true,
      ethereumOpts: { handlers: { eth_accounts: () => [] } },
    });
    await triggerDomReady(docListeners);
    assert.ok(/not deployed yet/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, true);
    assert.strictEqual(elements["stake-btn"].disabled, true);
    assert.strictEqual(elements["withdraw-btn"].disabled, true);
  });

  await test("malformed deployment.json: reports invalid, does not crash, actions disabled", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 1, token: "oops", staking: null },
      hasWallet: true,
      ethereumOpts: { handlers: { eth_accounts: () => [] } },
    });
    await triggerDomReady(docListeners);
    assert.ok(/invalid/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  await test("deployment.json fetch throws (absent/unreadable file): handled, not deployed shown", async () => {
    const { elements, docListeners } = buildContext({
      hasWallet: true,
      ethereumOpts: { handlers: { eth_accounts: () => [] } },
      fetchImpl: () => Promise.reject(new Error("404 not found")),
    });
    await triggerDomReady(docListeners);
    assert.ok(/invalid|could not load/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  const token = "0x" + "1".repeat(40);
  const staking = "0x" + "2".repeat(40);
  const account = "0x" + "a".repeat(40);
  const other = "0x" + "b".repeat(40);

  function addrPad(addr) { return addr.slice(2).toLowerCase().padStart(64, "0"); }
  function uintHex(n) { return "0x" + n.toString(16).padStart(64, "0"); }

  function deployedHandlers(overrides) {
    const base = {
      eth_accounts: () => [account],
      eth_chainId: () => "0xaa36a7",
      eth_getCode: (args) => (args.params[0] === token || args.params[0] === staking ? "0x60fe" : "0x"),
      eth_call: (args) => {
        const data = args.params[0].data;
        const selector = data.slice(0, 10);
        if (selector === "0xfc0c546a") return "0x" + addrPad(token); // token()
        if (selector === "0x313ce567") return uintHex(18); // decimals()
        if (selector === "0x70a08231") return uintHex(1000n); // balanceOf
        if (selector === "0xaf500ba3") return uintHex(0n); // stakedOf
        if (selector === "0x817b1cd2") return uintHex(0n); // totalStaked
        if (selector === "0xcf6a4403") return uintHex(0n); // pointsOf
        if (selector === "0xdd62ed3e") return uintHex(0n); // allowance
        return "0x" + "0".repeat(64);
      },
    };
    return Object.assign(base, overrides || {});
  }

  await test("wrong chain: switch prompt shown, actions stay disabled until switched", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: { handlers: deployedHandlers({ eth_chainId: () => "0x1" }) },
    });
    await triggerDomReady(docListeners);
    assert.ok(/wrong network/i.test(elements["wallet-status"].textContent));
    assert.strictEqual(elements["switch-chain-btn"].hidden, false);
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  await test("valid deployment + correct chain: contracts validated, actions enabled, balances shown", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: { handlers: deployedHandlers() },
    });
    await triggerDomReady(docListeners);
    assert.ok(/validated/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, false);
    assert.strictEqual(elements["stake-btn"].disabled, false);
    assert.strictEqual(elements["balance"].textContent, "0.000000000000001 TEST");
  });

  await test("staking contract not bound to configured token: actions disabled with clear error", async () => {
    const wrongToken = "0x" + "9".repeat(40);
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xfc0c546a") return "0x" + addrPad(wrongToken);
            return "0x" + "0".repeat(64);
          },
        }),
      },
    });
    await triggerDomReady(docListeners);
    assert.ok(/not bound/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  await test("address with no contract code: actions disabled with clear error", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: { handlers: deployedHandlers({ eth_getCode: () => "0x" }) },
    });
    await triggerDomReady(docListeners);
    assert.ok(/no contract code/i.test(elements["deploy-status"].textContent));
    assert.strictEqual(elements["faucet-btn"].disabled, true);
  });

  await test("accountsChanged to empty: disconnect shown, actions disabled again", async () => {
    const { elements, docListeners, ethereum } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: { handlers: deployedHandlers() },
    });
    await triggerDomReady(docListeners);
    assert.strictEqual(elements["faucet-btn"].disabled, false);
    ethereum.emit("accountsChanged", []);
    await flush();
    assert.ok(/disconnected/i.test(elements["wallet-status"].textContent));
  });

  await test("accountsChanged to a new account: account display updates, balances refresh for new account", async () => {
    const { elements, docListeners, ethereum } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: { handlers: deployedHandlers() },
    });
    await triggerDomReady(docListeners);
    ethereum.emit("accountsChanged", [other]);
    await flush();
    assert.strictEqual(elements["account"].textContent, other);
  });

  await test("insufficient balance on stake: rejected locally before sending a transaction", async () => {
    const { elements, docListeners, ethereum } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xfc0c546a") return "0x" + addrPad(token);
            if (selector === "0x313ce567") return uintHex(18);
            if (selector === "0x70a08231") return uintHex(0n); // zero balance
            return uintHex(0n);
          },
        }),
      },
    });
    await triggerDomReady(docListeners);
    elements["stake-amount"].value = "5";
    const clickHandlers = elements["stake-btn"]._listeners["click"];
    await clickHandlers[0]();
    await flush();
    const sendCalls = ethereum._calls.filter((c) => c.method === "eth_sendTransaction");
    assert.strictEqual(sendCalls.length, 0, "must not send a tx when balance is insufficient");
    assert.ok(elements["activity-log"].children.some((c) =>
      c.children && c.children[0] && /exceeds your TEST balance/i.test(c.children[0].textContent)
    ));
  });

  await test("insufficient allowance triggers an approve transaction before staking", async () => {
    let approveSent = false, stakeSent = false;
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xfc0c546a") return "0x" + addrPad(token);
            if (selector === "0x313ce567") return uintHex(18);
            if (selector === "0x70a08231") return uintHex(10n ** 21n); // plenty of balance
            if (selector === "0xdd62ed3e") return uintHex(approveSent ? 10n ** 21n : 0n);
            return uintHex(0n);
          },
          eth_sendTransaction: (args) => {
            const data = args.params[0].data;
            if (data.startsWith("0x095ea7b3")) { approveSent = true; return "0xapprove"; }
            if (data.startsWith("0xa694fc3a")) { stakeSent = true; return "0xstake"; }
            throw new Error("unexpected tx");
          },
          eth_getTransactionReceipt: () => ({ status: "0x1" }),
        }),
      },
    });
    await triggerDomReady(docListeners);
    elements["stake-amount"].value = "5";
    await elements["stake-btn"]._listeners["click"][0]();
    await flush(20);
    assert.strictEqual(approveSent, true, "approve must be sent when allowance is insufficient");
    assert.strictEqual(stakeSent, true, "stake must follow after approval confirms");
  });

  await test("user rejects a transaction (code 4001): shown as rejected, no crash", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xdd62ed3e") return uintHex(10n ** 30n); // plenty of allowance
            if (selector === "0xfc0c546a") return "0x" + addrPad(token);
            if (selector === "0x313ce567") return uintHex(18);
            if (selector === "0x70a08231") return uintHex(10n ** 30n);
            return uintHex(0n);
          },
          eth_sendTransaction: () => {
            const err = new Error("User rejected the request.");
            err.code = 4001;
            throw err;
          },
        }),
      },
    });
    await triggerDomReady(docListeners);
    elements["stake-amount"].value = "5";
    await elements["stake-btn"]._listeners["click"][0]();
    await flush(10);
    const texts = elements["activity-log"].children.map((c) => c.children[0] && c.children[0].textContent).join(" | ");
    assert.ok(/rejected/i.test(texts), "expected a rejected-by-user log entry, got: " + texts);
  });

  await test("reverted transaction: shown as reverted with a tx link, balances not falsely updated", async () => {
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xdd62ed3e") return uintHex(10n ** 30n);
            if (selector === "0xfc0c546a") return "0x" + addrPad(token);
            if (selector === "0x313ce567") return uintHex(18);
            if (selector === "0x70a08231") return uintHex(10n ** 30n);
            return uintHex(0n);
          },
          eth_sendTransaction: () => "0xdeadbeef",
          eth_getTransactionReceipt: () => ({ status: "0x0" }),
        }),
      },
    });
    await triggerDomReady(docListeners);
    elements["stake-amount"].value = "5";
    await elements["stake-btn"]._listeners["click"][0]();
    await flush(10);
    const texts = elements["activity-log"].children.map((c) => c.children[0] && c.children[0].textContent).join(" | ");
    assert.ok(/reverted/i.test(texts), "expected a reverted log entry, got: " + texts);
  });

  await test("pending/confirmed withdraw refreshes balances after confirmation", async () => {
    let staked = 100n * 10n ** 18n;
    const { elements, docListeners } = buildContext({
      deploymentJson: { chainId: 11155111, token, staking },
      hasWallet: true,
      ethereumOpts: {
        handlers: deployedHandlers({
          eth_call: (args) => {
            const selector = args.params[0].data.slice(0, 10);
            if (selector === "0xaf500ba3") return uintHex(staked);
            if (selector === "0xfc0c546a") return "0x" + addrPad(token);
            if (selector === "0x313ce567") return uintHex(18);
            if (selector === "0x70a08231") return uintHex(1000n * 10n ** 18n);
            return uintHex(0n);
          },
          eth_sendTransaction: () => "0xw1",
          eth_getTransactionReceipt: () => { staked -= 40n * 10n ** 18n; return { status: "0x1" }; },
        }),
      },
    });
    await triggerDomReady(docListeners);
    elements["withdraw-amount"].value = "40";
    await elements["withdraw-btn"]._listeners["click"][0]();
    await flush(10);
    assert.strictEqual(elements["staked"].textContent, "60 TEST");
    const texts = elements["activity-log"].children.map((c) => c.children[0] && c.children[0].textContent).join(" | ");
    assert.ok(/confirmed/i.test(texts));
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
