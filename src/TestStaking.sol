// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Minimal {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title TestStaking
/// @notice Stake the bound token to earn points. A global emission of exactly one point
///         per second is split among stakers pro rata to their active stake. Periods with
///         no stake earn nothing. Withdrawing never removes points already earned.
/// @dev `pointsOf` uses 1e18 units per point. O(1) accumulator accounting with 1e36
///      precision. No owner, fee, lock or upgrade path.
contract TestStaking {
    /// @notice Points emitted per second, in 1e18 units per point (i.e. 1 point/second).
    uint256 public constant POINTS_PER_SECOND = 1e18;
    /// @notice Fixed-point precision of the per-token accumulator.
    uint256 public constant ACC_PRECISION = 1e36;

    address public immutable token;

    uint256 public totalStaked;
    /// @notice Cumulative points (1e18 units) per staked base unit, scaled by ACC_PRECISION.
    uint256 public accPointsPerToken;
    uint256 public lastUpdate;

    mapping(address => uint256) public stakedOf;
    mapping(address => uint256) internal _points;
    mapping(address => uint256) internal _userAcc;

    uint256 private _lock = 1;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    error InvalidToken();
    error ZeroAmount();
    error InsufficientStake(uint256 staked, uint256 requested);
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address token_) {
        if (token_.code.length == 0) revert InvalidToken();
        token = token_;
        lastUpdate = block.timestamp;
    }

    /// @notice Stake `amount` base units. Caller must have approved this contract.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender);
        stakedOf[msg.sender] += amount;
        totalStaked += amount;
        _safeCall(abi.encodeCall(IERC20Minimal.transferFrom, (msg.sender, address(this), amount)));
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw `amount` base units of the caller's own stake. Points are kept.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 staked = stakedOf[msg.sender];
        if (amount > staked) revert InsufficientStake(staked, amount);
        _settle(msg.sender);
        unchecked {
            stakedOf[msg.sender] = staked - amount;
        }
        totalStaked -= amount;
        _safeCall(abi.encodeCall(IERC20Minimal.transfer, (msg.sender, amount)));
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Points earned by `user` up to the current block, 1e18 units per point.
    function pointsOf(address user) external view returns (uint256) {
        uint256 acc = accPointsPerToken;
        if (block.timestamp > lastUpdate && totalStaked != 0) {
            acc += ((block.timestamp - lastUpdate) * POINTS_PER_SECOND * ACC_PRECISION) / totalStaked;
        }
        return _points[user] + (stakedOf[user] * (acc - _userAcc[user])) / ACC_PRECISION;
    }

    function _updateGlobal() internal {
        if (block.timestamp > lastUpdate) {
            if (totalStaked != 0) {
                accPointsPerToken +=
                    ((block.timestamp - lastUpdate) * POINTS_PER_SECOND * ACC_PRECISION) / totalStaked;
            }
            lastUpdate = block.timestamp;
        }
    }

    function _settle(address user) internal {
        _updateGlobal();
        uint256 acc = accPointsPerToken;
        // stake * (acc delta) <= elapsed * 1e54 because stake <= totalStaked: no overflow.
        _points[user] += (stakedOf[user] * (acc - _userAcc[user])) / ACC_PRECISION;
        _userAcc[user] = acc;
    }

    function _safeCall(bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
