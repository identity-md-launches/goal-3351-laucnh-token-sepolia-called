# Contracts: TestToken and TestStaking

Target network: Sepolia (chainId 11155111). Deployment status: **not_deployed** (this package builds artifacts only).

## TestToken (`src/TestToken.sol`)
- ERC-20, name `test`, symbol `test`, decimals 18. Ownerless: no owner, admin, pause or upgrade.
- `constructor()` mints 1,000,000 * 1e18 to `msg.sender`, i.e. the account that actually deploys it.
- `mint(uint256 amount)`: public faucet, mints to the caller, requires `0 < amount <= 1,000 * 1e18` per call
  (reverts `InvalidMintAmount`). **Testnet design choice:** anyone can mint, there is no cooldown, so the supply is
  unbounded and the token has no value. Do not deploy it to mainnet.
- Standard `balanceOf`, `allowance`, `transfer`, `approve`, `transferFrom` (returns `true`, reverts on failure),
  `Transfer` / `Approval` events. Allowance of `type(uint256).max` is not decremented. Transfers to the zero address
  and approvals of the zero-address spender revert.

## TestStaking (`src/TestStaking.sol`)
- `constructor(address token)`: token bound `immutable` (must have code). No fee, lock, admin or upgrade.
- `stake(uint256)`, `withdraw(uint256)`, `token()`, `totalStaked()`, `stakedOf(address)`, `pointsOf(address)`.
- Points: one point per second (`1e18` units per point) shared pro rata among the active stake. Periods with
  `totalStaked == 0` earn nothing. Withdrawing keeps all earned points; a user may restake at any time.
- O(1) accounting: global `accPointsPerToken` scaled by `ACC_PRECISION = 1e36`, per-user snapshot; accrual is settled
  before every stake change. Division rounds down, so the sum of all points never exceeds the emission (dust of a few
  base units per settlement).
- Events: `Staked(address indexed user, uint256 amount)`, `Withdrawn(address indexed user, uint256 amount)`.
- Errors: `ZeroAmount`, `InsufficientStake(staked, requested)` (also covers withdrawing someone else's stake: you can
  only withdraw your own `stakedOf`), `TransferFailed` (token call reverted or returned `false`), `Reentrancy`,
  `InvalidToken`. State changes happen before the token call, guarded by a reentrancy lock.

## Build, test and regenerate (offline)
Foundry 1.9.0, solc 0.8.28 (installed locally), default Foundry settings (optimizer off, evm `prague`), no config file
changes and no external Solidity imports (tests use a minimal local cheatcode interface in `test/contracts/Base.sol`).

```
forge test --offline --use 0.8.28 --match-path 'test/contracts/*'   # 43 tests, all pass
bash contract-artifacts/generate.sh                                  # rebuilds src/ and rewrites artifacts
```

`generate.sh` compiles `src/` with `forge build --force` into a temporary directory and extracts, per contract,
`abi`, `bytecode` (creation), `deployedBytecode`, `compiler` and the raw solc `metadata` JSON into
`contract-artifacts/<Name>.json`. Two consecutive runs produced identical hashes.

## Hashes (sha256)
| File | sha256 |
|---|---|
| src/TestToken.sol | e241bcc04d7e6f8a90607d07985b15657a5f24c96d83f5a84ba535e8a0ad73e6 |
| src/TestStaking.sol | fa86dc825cbdc73fc6a76c4b727956811872e1d8443946c85d75b7d034b312af |
| contract-artifacts/TestToken.json | 6c72dc9bcf4d23735c103b1aee16cf6ef5d075209964cb004e680fae26822604 |
| contract-artifacts/TestStaking.json | e4f4e7a1a895a4957ca4c7a5891fb3f80d1c551f2c0d6ad8e272c592d8415898 |

Compiler: `0.8.28+commit.7893614a`. Compilation failures: none.
