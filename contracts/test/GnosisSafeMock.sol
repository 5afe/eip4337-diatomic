// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "hardhat/console.sol";

contract GnosisSafeMock {
    address public owner;
    address public fallbackHandler;
    address public module;

    constructor(address _fallbackHandler, address _module) {
        owner = msg.sender;
        fallbackHandler = _fallbackHandler;
        module = _module;
    }

    function signatureSplit(bytes memory signature)
        internal
        pure
        returns (
            uint8 v,
            bytes32 r,
            bytes32 s
        )
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
    }

    function checkSignatures(
        bytes32 dataHash,
        bytes memory,
        bytes memory signature
    ) public view {
        uint8 v;
        bytes32 r;
        bytes32 s;
        (v, r, s) = signatureSplit(signature);
        require(
            owner == ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v, r, s),
            "Invalid signature"
        );
    }

    function execTransactionFromModule(
        address payable to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external returns (bool success) {
        require(module != address(0) && msg.sender == module, "not executing that");

        if (operation == 1) (success, ) = to.delegatecall(data);
        else (success, ) = to.call{value: value}(data);
    }

    // solhint-disable-next-line payable-fallback,no-complex-fallback
    fallback() external payable {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let handler := sload(fallbackHandler.slot)
            if iszero(handler) {
                return(0, 0)
            }
            calldatacopy(0, 0, calldatasize())
            // The msg.sender address is shifted to the left by 12 bytes to remove the padding
            // Then the address without padding is stored right after the calldata
            mstore(calldatasize(), shl(96, caller()))
            // Add 20 bytes for the address appended add the end
            let success := call(gas(), handler, 0, 0, add(calldatasize(), 20), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(success) {
                revert(0, returndatasize())
            }
            return(0, returndatasize())
        }
    }

    receive() external payable {}
}
