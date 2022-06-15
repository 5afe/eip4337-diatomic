import { BigNumber } from 'ethers'
import { AddressZero } from '@ethersproject/constants'
import hre, { deployments } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import {
  deployContract,
  getTestSafe,
  getEip4337Diatomic,
  getSafeAtAddress,
  getStorageSetterAtAddress,
  getTestStorageSetter,
} from '../test/utils/setup'
import { buildSignatureBytes, signHash } from '../src/utils/execution'
import {
  buildSafeUserOp,
  buildSafeUserOpContractCall,
  getRequiredPrefund,
  calculateSafeOperationHash,
  buildUserOperationFromSafeUserOperation,
  calculateIntermediateTxHash,
  buildSafeUserOpTransaction,
  getSupportedEntryPoints,
} from '../src/utils/userOp'
import { parseEther } from '@ethersproject/units'
import { chainId } from '../test/utils/encoding'

const MNEMONIC = process.env.GOERLI_SCRIPT_MNEMONIC
const SAFE_ADDRESS = process.env.GOERLI_SCRIPT_SAFE_ADDRESS
const STORAGE_SETTER_ADDRESS = process.env.GOERLI_SCRIPT_STORAGE_SETTER_ADDRESS
const DEBUG = process.env.GOERLI_SCRIPT_DEBUG || false

const runOp = async () => {
  const user1 = MNEMONIC ? hre.ethers.Wallet.fromMnemonic(MNEMONIC).connect(hre.ethers.provider) : (await hre.ethers.getSigners())[0]

  // This node only allows eth_chainId, eth_getSupportedEntrypoints, eth_sendUserOperation
  // All other methods return an error
  const accountAbstractionProvider = new hre.ethers.providers.JsonRpcProvider('https://account-abstraction-goerli.nethermind.io/')
  const eip4337Diatomic = await getEip4337Diatomic()
  const safe = await (SAFE_ADDRESS ? getSafeAtAddress(SAFE_ADDRESS) : getTestSafe(user1, eip4337Diatomic.address, eip4337Diatomic.address))
  const eip4337Safe = eip4337Diatomic.attach(safe.address)
  const storageSetter = await (STORAGE_SETTER_ADDRESS ? getStorageSetterAtAddress(STORAGE_SETTER_ADDRESS) : getTestStorageSetter(user1))
  const entryPoints = await getSupportedEntryPoints(accountAbstractionProvider)
  const safeOp = buildSafeUserOpContractCall(
    storageSetter,
    'setStorage',
    ['123456789'],
    eip4337Safe.address,
    '0',
    '0',
    entryPoints[0],
    false,
    { maxFeePerGas: '10', maxPriorityFeePerGas: '5' },
  )
  const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
  const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
  const userOp = buildUserOperationFromSafeUserOperation({
    safeAddress: eip4337Safe.address,
    safeOp,
    signature,
  })

  if (DEBUG) {
    console.log('Usign account with address:', user1.address)
    console.log('Using EIP4337Diatomic deployed at:', eip4337Diatomic.address)
    console.log('Using Safe contract deployed at:', safe.address)
    console.log('Using StorageSetter deployed at:', storageSetter.address)
    console.log('Using entrypoint at:', entryPoints[0])
    console.log(
      'Encoded validateUserOp call:',
      eip4337Diatomic.interface.encodeFunctionData('validateUserOp', [userOp, `0x${'0'.padStart(64, '0')}`, getRequiredPrefund(userOp)]),
    )
  }

  await accountAbstractionProvider.send('eth_sendUserOperation', [userOp, entryPoints[0]])

  console.log(
    await hre.ethers.provider.getStorageAt(storageSetter.address, '0x7373737373737373737373737373737373737373737373737373737373737373'),
  )
}

runOp()
