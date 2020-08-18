pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../HandlerBase.sol";
import "./IMooniFactory.sol";
import "./IMooniswap.sol";


contract HMooniswap is HandlerBase {
    using SafeERC20 for IERC20;

    address payable public constant MooniFactory = 0x71CD6666064C3A1354a3B4dca5fA1E2D3ee7D303;

    function deposit(
        address[2] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata minAmounts
    ) external payable returns (uint256 fairSupply) {
        require(tokens[0] < tokens[1], "wrong tokens order");
        require(amounts.length == tokens.length, "wrong amounts length");

        IMooniFactory factory = IMooniFactory(MooniFactory);
        IMooniswap mooniswap = IMooniswap(factory.pools(tokens[0], tokens[1]));

        // Approve token
        uint256 value = 0;
        if (tokens[0] == address(0)) {
            value = amounts[0];
        } else {
            IERC20(tokens[0]).safeApprove(address(mooniswap), amounts[0]);
        }
        IERC20(tokens[1]).safeApprove(address(mooniswap), amounts[1]);

        // Add liquidity
        fairSupply = mooniswap.deposit.value(value)(amounts, minAmounts);

        // Approve token 0
        if (tokens[0] != address(0)) {
            IERC20(tokens[0]).safeApprove(address(mooniswap), 0);
        }
        IERC20(tokens[1]).safeApprove(address(mooniswap), 0);

        // Update involved token
        _updateToken(address(mooniswap));
    }

    function withdraw(
        address pool,
        uint256 amount,
        uint256[] calldata minReturns
    ) external payable {
        // Get mooniswap
        IMooniswap mooniswap = IMooniswap(pool);

        // Remove liquidity
        mooniswap.withdraw(amount, minReturns);

        // Update involved token except ETH
        address[] memory tokens = mooniswap.getTokens();
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] != address(0)) {
                _updateToken(address(tokens[i]));
            }
        }
    }
}
