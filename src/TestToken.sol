// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title TestToken ("test" / "test")
/// @notice Ownerless ERC-20 for the Sepolia (chainId 11155111) staking demo.
/// @dev The constructor mints 1,000,000 tokens to the deploying account (msg.sender).
///      `mint` is a public, permissionless faucet: a deliberate TESTNET design choice.
///      Any caller may mint up to 1,000 tokens per call to itself; this token has no
///      value and must not be deployed to a production network.
contract TestToken {
    string public constant name = "test";
    string public constant symbol = "test";
    uint8 public constant decimals = 18;

    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 1e18;
    uint256 public constant MAX_MINT_PER_CALL = 1_000 * 1e18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InvalidMintAmount(uint256 amount);
    error InsufficientBalance(uint256 balance, uint256 needed);
    error InsufficientAllowance(uint256 allowance, uint256 needed);
    error InvalidReceiver(address receiver);
    error InvalidSpender(address spender);

    constructor() {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /// @notice Testnet faucet: mints `amount` base units to the caller.
    /// @dev Requires 0 < amount <= 1,000 * 1e18. No cooldown; limit is per call.
    function mint(uint256 amount) external {
        if (amount == 0 || amount > MAX_MINT_PER_CALL) revert InvalidMintAmount(amount);
        _mint(msg.sender, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        if (spender == address(0)) revert InvalidSpender(spender);
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance(allowed, value);
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidReceiver(to);
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance(bal, value);
        unchecked {
            balanceOf[from] = bal - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
