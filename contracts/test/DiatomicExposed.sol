// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

import "../SafeEIP4337Diatomic.sol";

contract DiatomicExposed is SafeEIP4337Diatomic {
    function exposedGetIntermediateTransactionHash(
        bytes memory callData,
        uint256 nonce,
        address entryPoint,
        uint256 chainId
    ) public pure returns (bytes32) {
        return getIntermediateTransactionHash(callData, nonce, entryPoint, chainId);
    }
}
