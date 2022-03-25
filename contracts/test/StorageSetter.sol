// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0;

import "hardhat/console.sol";

contract StorageSetter {
    function setStorage(uint256 numba) public {
        bytes32 slot = 0x7373737373737373737373737373737373737373737373737373737373737373;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, numba)
        }
    }
}
