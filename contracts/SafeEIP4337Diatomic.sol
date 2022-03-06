// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.7.0 <0.9.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/handler/HandlerContext.sol";
import "./UserOperation.sol";

/// ERRORS ///

/// @notice Thrown when `validateUserOp` wasn't called through the Safe
error InvalidCaller();

/// @notice Thrown when userOp suggests a mismatching nonce
error InvalidNonce();

/// @notice Thrown when the prefund quoted by the entrypoint is larger than one defined in the userOp
error InvalidPrefund();

/// @notice Thrown when trying to execute a transaction that was not marked as ready to execute
error InvalidTransaction();

/// @notice Thrown when the transaction from the operation reverts
error ExecutionFailure();

/// @title SafeEIP4337Diatomic
/// @author Mikhail Mikheev - <mikhail@gnosis.io>
/// @notice Diatomic implementation of EIP-4337 for the Gnosis Safe, consisting of a module and a fallback handler
contract SafeEIP4337Diatomic is HandlerContext {
    using UserOperationLib for UserOperation;

    enum Operation {
        Call,
        DelegateCall
    }

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 private constant SAFE_OP_TYPEHASH =
        keccak256(
            "SafeOp(address safe,bytes callData,uint256 nonce,uint256 verificationGas,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 callGas,address entryPoint)"
        );

    mapping(address => uint256) public safeNonces;
    // A mapping to keep track of transactions hashes ready to be executed, a transaction is marked as such
    // if `validateUserOp` passes.
    mapping(address => bytes32) public transactionsReadyToExecute;

    /// @dev Validates user operation provided by the entry point
    /// @param userOp User operation struct
    /// @param requiredPrefund Required prefund to execute the operation
    function validateUserOp(
        UserOperation calldata userOp,
        bytes32,
        uint256 requiredPrefund
    ) external {
        address payable safeAddress = payable(userOp.sender);
        // The entryPoint address is appended to the calldata in `HandlerContext` contract
        // Because of this, the relayer may be manipulate the entryPoint address, therefore we have to verify that
        // the sender is the Safe specified in the userOperation
        if (safeAddress != msg.sender) revert InvalidCaller();

        // We need to increase the nonce to make it impossible to drain the safe by making it send prefunds for the same transaction
        uint256 safeNonce = safeNonces[safeAddress]++;
        if (safeNonce != userOp.nonce) revert InvalidNonce();

        // We need to make sure that the entryPoint's requested prefund is in bounds
        if (requiredPrefund > userOp.requiredPreFund()) revert InvalidPrefund();

        address entryPoint = _msgSender();
        _validateSignatures(entryPoint, userOp);

        bytes32 intermediateTxHash = getIntermediateTransactionHash(userOp.callData, safeNonce, entryPoint, block.chainid);
        transactionsReadyToExecute[safeAddress] = intermediateTxHash;

        if (requiredPrefund != 0) {
            GnosisSafe(safeAddress).execTransactionFromModule(entryPoint, requiredPrefund, "0x", Enum.Operation.Call);
        }
    }

    /// @dev Executes the operation if it was marked as ready to execute during `validateUserOp`
    /// @param to Destination address of transaction
    /// @param value Native token value of transaction
    /// @param data Data payload of transaction.
    /// @param operation Operation type of transaction.
    /// @return success True if the transaction succeeded
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation
    ) external payable returns (bool success) {
        // we need to strip out msg.sender address appended by HandlerContext contract from the calldata
        bytes memory callData;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Load free memory location
            let pointer := mload(0x40)
            // We allocate memory for the return data by setting the free memory location to
            // current free memory location + data size + 32 bytes for data size value - 32 bytes for stripped msg.sender
            mstore(0x40, add(pointer, calldatasize()))
            // Store the size
            mstore(pointer, sub(calldatasize(), 20))
            // Store the data
            calldatacopy(add(pointer, 0x20), 0, sub(calldatasize(), 20))
            // Point the callData to the correct memory location
            callData := pointer
        }

        address payable safeAddress = payable(msg.sender);
        address entryPoint = _msgSender();
        // `validateUserOp` increased the nonce, so we need to use nonce - 1 for hash calculation
        uint256 safeNonce = safeNonces[safeAddress] - 1;
        if (transactionsReadyToExecute[safeAddress] != getIntermediateTransactionHash(callData, safeNonce, entryPoint, block.chainid)) {
            revert InvalidTransaction();
        }

        transactionsReadyToExecute[safeAddress] = 0;

        success = GnosisSafe(safeAddress).execTransactionFromModule(to, value, data, operation);
        if (!success) revert ExecutionFailure();
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    /// @dev Returns the bytes that are hashed to be signed by owners.
    /// @param safe Safe address
    /// @param callData Call data
    /// @param nonce Nonce of the operation
    /// @param verificationGas Gas required for verification
    /// @param preVerificationGas Gas required for pre-verification (e.g. for EOA signature verification)
    /// @param maxFeePerGas Max fee per gas
    /// @param maxPriorityFeePerGas Max priority fee per gas
    /// @param callGas Gas available during the execution of the call
    /// @param entryPoint Address of the entry point
    /// @return Operation hash bytes
    function encodeOperationData(
        address safe,
        bytes calldata callData,
        uint256 nonce,
        uint256 verificationGas,
        uint256 preVerificationGas,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 callGas,
        address entryPoint
    ) public view returns (bytes memory) {
        bytes32 safeOperationHash = keccak256(
            abi.encode(
                SAFE_OP_TYPEHASH,
                safe,
                keccak256(callData),
                nonce,
                verificationGas,
                preVerificationGas,
                maxFeePerGas,
                maxPriorityFeePerGas,
                callGas,
                entryPoint
            )
        );

        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeOperationHash);
    }

    /// @dev Returns operation hash to be signed by owners.
    /// @param safe Safe address
    /// @param callData Call data
    /// @param nonce Nonce of the operation
    /// @param verificationGas Gas required for verification
    /// @param preVerificationGas Gas required for pre-verification (e.g. for EOA signature verification)
    /// @param maxFeePerGas Max fee per gas
    /// @param maxPriorityFeePerGas Max priority fee per gas
    /// @param callGas Gas available during the execution of the call
    /// @param entryPoint Address of the entry point
    /// @return Operation hash
    function getOperationHash(
        address safe,
        bytes calldata callData,
        uint256 nonce,
        uint256 verificationGas,
        uint256 preVerificationGas,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas,
        uint256 callGas,
        address entryPoint
    ) public view returns (bytes32) {
        return
            keccak256(
                encodeOperationData(
                    safe,
                    callData,
                    nonce,
                    verificationGas,
                    preVerificationGas,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    callGas,
                    entryPoint
                )
            );
    }

    /// @dev calculates the intermediate transaction hash used to mark the transaction as ready to execute
    /// @param callData Call data
    /// @param nonce Nonce of the transaction
    /// @param entryPoint Address of the entry point
    /// @param chainId Chain id of the transaction
    /// @return Intermediate transaction hash
    function getIntermediateTransactionHash(
        bytes memory callData,
        uint256 nonce,
        address entryPoint,
        uint256 chainId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(callData, nonce, entryPoint, chainId));
    }

    /// @dev Validates that the user operation is correctly signed. Users methods from Gnosis Safe contract, reverts if signatures are invalid
    /// @param entryPoint Address of the entry point
    /// @param userOp User operation struct
    function _validateSignatures(address entryPoint, UserOperation calldata userOp) internal view {
        bytes memory operationData = encodeOperationData(
            payable(userOp.sender),
            userOp.callData,
            userOp.nonce,
            userOp.verificationGas,
            userOp.preVerificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            userOp.callGas,
            entryPoint
        );
        bytes32 operationHash = keccak256(operationData);

        GnosisSafe(payable(userOp.sender)).checkSignatures(operationHash, operationData, userOp.signature);
    }
}
