import { Contract, BigNumber, utils as ethersUtils, BigNumberish, ethers } from 'ethers'
import { AddressZero } from '@ethersproject/constants'

type OptionalExceptFor<T, TRequired extends keyof T = keyof T> = Partial<Pick<T, Exclude<keyof T, TRequired>>> &
  Required<Pick<T, TRequired>>

export interface UserOperation {
  sender: string
  nonce: string
  initCode: string
  callData: string
  callGas: string
  verificationGas: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymaster: string
  paymasterData: string
  signature: string
}

export interface SafeUserOperation {
  safe: string
  callData: string
  nonce: string
  verificationGas: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  callGas: string
  entryPoint: string
}

export const EIP712_SAFE_OPERATION_TYPE = {
  // "SafeOp(bytes callData,uint256 nonce,uint256 verificationGas,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 callGas,address entryPoint)"
  SafeOp: [
    { type: 'address', name: 'safe' },
    { type: 'bytes', name: 'callData' },
    { type: 'uint256', name: 'nonce' },
    { type: 'uint256', name: 'verificationGas' },
    { type: 'uint256', name: 'preVerificationGas' },
    { type: 'uint256', name: 'maxFeePerGas' },
    { type: 'uint256', name: 'maxPriorityFeePerGas' },
    { type: 'uint256', name: 'callGas' },
    { type: 'address', name: 'entryPoint' },
  ],
}

export const calculateSafeOperationHash = (eip4337ModuleAddress: string, safeOp: SafeUserOperation, chainId: BigNumberish): string => {
  return ethersUtils._TypedDataEncoder.hash({ chainId, verifyingContract: eip4337ModuleAddress }, EIP712_SAFE_OPERATION_TYPE, safeOp)
}

export const buildSafeUserOp = (template: OptionalExceptFor<SafeUserOperation, 'safe' | 'nonce' | 'entryPoint'>): SafeUserOperation => {
  // use same maxFeePerGas and maxPriorityFeePerGas to ease testing prefund validation
  // otherwise it's tricky to calculate the prefund because of dynamic parameters like block.basefee
  // check UserOperation.sol#gasPrice()
  return {
    safe: template.safe,
    nonce: template.nonce,
    entryPoint: template.entryPoint,
    callData: template.callData || '0x',
    verificationGas: template.verificationGas || '1000000',
    preVerificationGas: template.preVerificationGas || '21000',
    callGas: template.callGas || '2000000',
    maxFeePerGas: template.maxFeePerGas || '10000000000',
    maxPriorityFeePerGas: template.maxPriorityFeePerGas || '10000000000',
  }
}

export const buildSafeUserOpTransaction = (
  from: string,
  to: string,
  value: BigNumberish,
  data: string,
  nonce: string,
  entryPoint: string,
  delegateCall?: boolean,
  overrides?: Partial<SafeUserOperation>,
): SafeUserOperation => {
  const abi = [
    'function execTransaction(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bool success)',
  ]
  const callData = new ethersUtils.Interface(abi).encodeFunctionData('execTransaction', [to, value, data, delegateCall ? 1 : 0])

  return buildSafeUserOp(
    Object.assign(
      {
        safe: from,
        callData,
        nonce,
        entryPoint,
      },
      overrides,
    ),
  )
}

export const buildSafeUserOpContractCall = (
  contract: Contract,
  method: string,
  params: any[],
  safeAddress: string,
  nonce: string,
  operationValue: string,
  entryPoint: string,
  delegateCall?: boolean,
  overrides?: Partial<SafeUserOperation>,
): SafeUserOperation => {
  const data = contract.interface.encodeFunctionData(method, params)

  return buildSafeUserOpTransaction(safeAddress, contract.address, operationValue, data, nonce, entryPoint, delegateCall, overrides)
}

export const buildUserOperationFromSafeUserOperation = ({
  safeOp,
  signature,
}: {
  safeAddress: string
  safeOp: SafeUserOperation
  signature: string
}): UserOperation => {
  return {
    nonce: safeOp.nonce,
    callData: safeOp.callData || '0x',
    verificationGas: safeOp.verificationGas || '1000000',
    preVerificationGas: safeOp.preVerificationGas || '21000',
    callGas: safeOp.callGas || '2000000',
    // use same maxFeePerGas and maxPriorityFeePerGas to ease testing prefund validation
    // otherwise it's tricky to calculate the prefund because of dynamic parameters like block.basefee
    // check UserOperation.sol#gasPrice()
    maxFeePerGas: safeOp.maxFeePerGas || '5000000000',
    maxPriorityFeePerGas: safeOp.maxPriorityFeePerGas || '1500000000',
    initCode: '0x',
    paymaster: AddressZero,
    paymasterData: '0x',
    sender: safeOp.safe,
    signature: signature,
  }
}

export const getRequiredGas = (userOp: UserOperation): string => {
  let multiplier = 3
  if (userOp.paymaster === AddressZero) {
    multiplier = 1
  }

  return BigNumber.from(userOp.callGas)
    .add(BigNumber.from(userOp.verificationGas).mul(multiplier))
    .add(userOp.preVerificationGas)
    .toString()
}

export const getRequiredPrefund = (userOp: UserOperation): string => {
  return BigNumber.from(getRequiredGas(userOp)).mul(BigNumber.from(userOp.maxFeePerGas)).toString()
}

export const calculateIntermediateTxHash = (callData: string, nonce: BigNumberish, entryPoint: string, chainId: BigNumberish): string => {
  return ethersUtils.solidityKeccak256(['bytes', 'uint256', 'address', 'uint256'], [callData, nonce, entryPoint, chainId])
}

export const getSupportedEntryPoints = async (provider: ethers.providers.JsonRpcProvider): Promise<string[]> => {
  const supportedEntryPoints = await provider.send('eth_supportedEntryPoints', []).then((ret) => ret.map(ethers.utils.getAddress))

  return supportedEntryPoints
}
