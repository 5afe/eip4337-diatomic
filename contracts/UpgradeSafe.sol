// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.8.0 <0.9.0;

abstract contract BaseUpgradeSafe {

    address public immutable guard;
    bytes32 public immutable versionSlot;
    address public immutable expectedVersion;
    address public immutable targetVersion;

    constructor(bytes32 slot, address previousVersion, address newVersion) {
        guard = address(this);
        versionSlot = slot;
        expectedVersion = previousVersion;
        targetVersion = newVersion;
    }

    function loadAddress(bytes32 slot) internal view returns(address value) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            value := sload(slot)
        }
        
    }
    function setAddress(bytes32 slot, address value) internal {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, value)
        }
    }


    function checkPrecondition() internal view {
        require(guard != address(this), "Wrong operation! Use delegatecall");
        address current = loadAddress(versionSlot);
        require(current == expectedVersion, "Invalid version");
    }

    function finalize() internal {
        setAddress(versionSlot, targetVersion);
    }

}

contract UpgradeSafe is BaseUpgradeSafe{

    constructor() BaseUpgradeSafe(0, 0x3E5c63644E683549055b9Be8653de26E0B4CD36E, 0x1382ef6EB177927B8FfEB11A2CCFF810ef90aa8B) {
    }

    function migrate() external {
        checkPrecondition();
        finalize();
    }
}
