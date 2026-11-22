// Pure logic for the TEST/Sepolia staking site: ABI encoding, amount parsing and
// deployment-record validation. No DOM or wallet access here so it can be loaded
// both by the browser (via <script>) and by the Node test runner in site/tests/.
(function (root) {
  "use strict";

  var SEPOLIA_CHAIN_ID = 11155111;
  var SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

  // Function selectors (first 4 bytes of keccak256(signature)), precomputed offline
  // and cross-checked against well-known public values (e.g. balanceOf, approve,
  // transfer, mint, stake, withdraw) so no keccak implementation ships at runtime.
  var SELECTORS = {
    "name()": "0x06fdde03",
    "symbol()": "0x95d89b41",
    "decimals()": "0x313ce567",
    "totalSupply()": "0x18160ddd",
    "balanceOf(address)": "0x70a08231",
    "allowance(address,address)": "0xdd62ed3e",
    "approve(address,uint256)": "0x095ea7b3",
    "transfer(address,uint256)": "0xa9059cbb",
    "mint(uint256)": "0xa0712d68",
    "token()": "0xfc0c546a",
    "stake(uint256)": "0xa694fc3a",
    "withdraw(uint256)": "0x2e1a7d4d",
    "totalStaked()": "0x817b1cd2",
    "stakedOf(address)": "0xaf500ba3",
    "pointsOf(address)": "0xcf6a4403"
  };

  var ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

  function isValidAddress(value) {
    return typeof value === "string" && ADDRESS_RE.test(value);
  }

  // Validates the runtime deployment.json record. Returns an object describing
  // what is usable; never throws on malformed input, so callers can always show
  // "Not deployed yet" instead of crashing the page.
  function validateDeployment(data) {
    var errors = [];
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { valid: false, errors: ["deployment record is not an object"], chainId: null, token: null, staking: null };
    }
    if (data.chainId !== SEPOLIA_CHAIN_ID) {
      errors.push("chainId must equal " + SEPOLIA_CHAIN_ID + ", got " + JSON.stringify(data.chainId));
    }
    var token = null;
    if (data.token !== null && data.token !== undefined) {
      if (isValidAddress(data.token)) {
        token = data.token;
      } else {
        errors.push("token is not null and not a valid 0x address: " + JSON.stringify(data.token));
      }
    }
    var staking = null;
    if (data.staking !== null && data.staking !== undefined) {
      if (isValidAddress(data.staking)) {
        staking = data.staking;
      } else {
        errors.push("staking is not null and not a valid 0x address: " + JSON.stringify(data.staking));
      }
    }
    return {
      valid: errors.length === 0,
      errors: errors,
      chainId: typeof data.chainId === "number" ? data.chainId : null,
      token: token,
      staking: staking,
      deployed: errors.length === 0 && token !== null && staking !== null
    };
  }

  function padHex32(hexNoPrefix) {
    if (hexNoPrefix.length > 64) throw new Error("value does not fit in 32 bytes");
    return "0".repeat(64 - hexNoPrefix.length) + hexNoPrefix;
  }

  function encodeAddressArg(address) {
    if (!isValidAddress(address)) throw new Error("invalid address: " + address);
    return padHex32(address.slice(2).toLowerCase());
  }

  function encodeUint256Arg(value) {
    var big;
    if (typeof value === "bigint") {
      big = value;
    } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
      big = BigInt(value);
    } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      big = BigInt(value);
    } else {
      throw new Error("invalid uint256 value: " + value);
    }
    if (big < 0n) throw new Error("uint256 cannot be negative");
    if (big > (2n ** 256n - 1n)) throw new Error("uint256 overflow");
    return padHex32(big.toString(16));
  }

  function encodeCall(signature, args) {
    var selector = SELECTORS[signature];
    if (!selector) throw new Error("unknown selector for signature: " + signature);
    var parts = selector.slice(2);
    for (var i = 0; i < args.length; i++) {
      parts += args[i];
    }
    return "0x" + parts;
  }

  function decodeUint256(hexResult) {
    if (!hexResult || hexResult === "0x") return 0n;
    return BigInt(hexResult);
  }

  function decodeAddress(hexResult) {
    if (!hexResult || hexResult === "0x") return null;
    var stripped = hexResult.slice(2).padStart(64, "0");
    return "0x" + stripped.slice(24).toLowerCase();
  }

  // Parses a user-typed decimal amount string into base units as a BigInt,
  // using only string/integer arithmetic so no float rounding can ever occur.
  function parseUnits(amountStr, decimals) {
    if (typeof amountStr !== "string") throw new Error("amount must be a string");
    var trimmed = amountStr.trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
      throw new Error("amount must be a plain decimal number, e.g. 12.5");
    }
    var parts = trimmed.split(".");
    var whole = parts[0];
    var frac = parts[1] || "";
    if (frac.length > decimals) {
      throw new Error("amount has more than " + decimals + " decimal places");
    }
    frac = frac + "0".repeat(decimals - frac.length);
    var combined = (whole + frac).replace(/^0+(?=\d)/, "");
    return BigInt(combined);
  }

  // Formats a BigInt amount of base units back into an exact decimal string.
  function formatUnits(value, decimals) {
    var big = typeof value === "bigint" ? value : BigInt(value);
    var negative = big < 0n;
    if (negative) big = -big;
    var str = big.toString();
    if (str.length <= decimals) {
      str = "0".repeat(decimals - str.length + 1) + str;
    }
    var whole = str.slice(0, str.length - decimals) || "0";
    var frac = decimals > 0 ? str.slice(str.length - decimals) : "";
    frac = frac.replace(/0+$/, "");
    var result = frac.length > 0 ? whole + "." + frac : whole;
    return (negative ? "-" : "") + result;
  }

  var lib = {
    SEPOLIA_CHAIN_ID: SEPOLIA_CHAIN_ID,
    SEPOLIA_CHAIN_ID_HEX: SEPOLIA_CHAIN_ID_HEX,
    SELECTORS: SELECTORS,
    isValidAddress: isValidAddress,
    validateDeployment: validateDeployment,
    encodeAddressArg: encodeAddressArg,
    encodeUint256Arg: encodeUint256Arg,
    encodeCall: encodeCall,
    decodeUint256: decodeUint256,
    decodeAddress: decodeAddress,
    parseUnits: parseUnits,
    formatUnits: formatUnits
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = lib;
  } else {
    root.StakingLib = lib;
  }
})(typeof window !== "undefined" ? window : this);
