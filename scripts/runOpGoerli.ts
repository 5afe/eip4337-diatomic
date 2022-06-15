import { parseEther } from '@ethersproject/units'
import hre from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { getTestSafe, getEip4337Diatomic, getSafeAtAddress, getStorageSetterAtAddress, getTestStorageSetter } from '../test/utils/setup'
import { buildSignatureBytes, signHash } from '../src/utils/execution'
import {
  buildSafeUserOp,
  getRequiredPrefund,
  calculateSafeOperationHash,
  buildUserOperationFromSafeUserOperation,
  getSupportedEntryPoints,
  buildSafeUserOpTransaction,
} from '../src/utils/userOp'
import { chainId } from '../test/utils/encoding'

const MNEMONIC = process.env.GOERLI_SCRIPT_MNEMONIC
const SAFE_ADDRESS = process.env.GOERLI_SCRIPT_SAFE_ADDRESS
const DEBUG = process.env.GOERLI_SCRIPT_DEBUG || false

const runOp = async () => {
  const user1 = MNEMONIC ? hre.ethers.Wallet.fromMnemonic(MNEMONIC).connect(hre.ethers.provider) : (await hre.ethers.getSigners())[0]

  // This node only allows eth_chainId, eth_getSupportedEntrypoints, eth_sendUserOperation
  // All other methods return an error
  const accountAbstractionProvider = new hre.ethers.providers.JsonRpcProvider('https://account-abstraction-goerli.nethermind.io/')
  const eip4337Diatomic = await getEip4337Diatomic()
  const safe = await (SAFE_ADDRESS ? getSafeAtAddress(SAFE_ADDRESS) : getTestSafe(user1, eip4337Diatomic.address, eip4337Diatomic.address))
  const eip4337Safe = eip4337Diatomic.attach(safe.address)
  const entryPoints = await getSupportedEntryPoints(accountAbstractionProvider)
  const safeOp = buildSafeUserOpTransaction(
    safe.address,
    '0x02270bd144e70cE6963bA02F575776A16184E1E6',
    parseEther('0.1'),
    '0x',
    '0',
    entryPoints[1],
    false,
    {
      maxFeePerGas: '9000000000',
      maxPriorityFeePerGas: '9000000000',
      callGas: '500000',
    },
  )

  const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
  let signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
  signature = `${signature.slice(0, -2)}1f`
  console.log({ safeOpHash, signature })
  const userOp = buildUserOperationFromSafeUserOperation({
    safeAddress: eip4337Safe.address,
    safeOp,
    signature,
  })

  if (DEBUG) {
    console.log('Usign account with address:', user1.address)
    console.log('Using EIP4337Diatomic deployed at:', eip4337Diatomic.address)
    console.log('Using Safe contract deployed at:', safe.address)
    console.log('Using entrypoint at:', entryPoints[1])
    console.log(
      'Encoded validateUserOp call:',
      eip4337Diatomic.interface.encodeFunctionData('validateUserOp', [userOp, `0x${'0'.padStart(64, '0')}`, getRequiredPrefund(userOp)]),
    )
  }

  await accountAbstractionProvider.send('eth_sendUserOperation', [userOp, entryPoints[1]])

  console.log('woohoo')
}

runOp()
