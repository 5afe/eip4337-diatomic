import { BigNumber } from 'ethers'
import { AddressZero } from '@ethersproject/constants'
import { expect } from 'chai'
import hre, { deployments, waffle } from 'hardhat'
import '@nomiclabs/hardhat-ethers'
import { deployContract, getTestSafe, getEip4337Diatomic } from '../utils/setup'
import { buildSignatureBytes, signHash } from '../../src/utils/execution'
import {
  buildSafeUserOp,
  buildSafeUserOpContractCall,
  getRequiredPrefund,
  calculateSafeOperationHash,
  buildUserOperationFromSafeUserOperation,
  calculateIntermediateTxHash,
  buildSafeUserOpTransaction,
} from '../../src/utils/userOp'
import { parseEther } from '@ethersproject/units'
import { chainId } from '../utils/encoding'

describe('SafeEIP4337Diatomic', async () => {
  const [user1, user2] = waffle.provider.getWallets()

  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const eip4337Diatomic = await getEip4337Diatomic()
    const safe = await getTestSafe(user1, eip4337Diatomic.address, eip4337Diatomic.address)

    const setterSource = `
        contract StorageSetter {
            function setStorage(bytes3 data) public {
                bytes32 slot = 0x7373737373737373737373737373737373737373737373737373737373737373;
                // solhint-disable-next-line no-inline-assembly
                assembly {
                    sstore(slot, data)
                }
            }
        }`
    const storageSetter = await deployContract(user1, setterSource)

    return {
      safe,
      eip4337Diatomic,
      eip4337Safe: eip4337Diatomic.attach(safe.address),
      storageSetter,
    }
  })

  describe('getOperationHash', () => {
    it('should correctly calculate EIP-712 hash of the operation', async () => {
      const { eip4337Diatomic, eip4337Safe, storageSetter } = await setupTests()

      const operation = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: AddressZero })
      const operationHash = await eip4337Safe.getOperationHash(
        eip4337Safe.address,
        operation.callData,
        operation.nonce,
        operation.verificationGas,
        operation.preVerificationGas,
        operation.maxFeePerGas,
        operation.maxPriorityFeePerGas,
        operation.callGas,
        operation.entryPoint,
      )

      expect(operationHash).to.equal(calculateSafeOperationHash(eip4337Diatomic.address, operation, await chainId()))

      const operation2 = buildSafeUserOpContractCall(storageSetter, 'setStorage', ['0xbaddad'], eip4337Safe.address, '0', '0', AddressZero)
      const operation2Hash = await eip4337Safe.getOperationHash(
        eip4337Safe.address,
        operation2.callData,
        operation2.nonce,
        operation2.verificationGas,
        operation2.preVerificationGas,
        operation2.maxFeePerGas,
        operation2.maxPriorityFeePerGas,
        operation2.callGas,
        operation2.entryPoint,
      )

      expect(operation2Hash).to.equal(calculateSafeOperationHash(eip4337Diatomic.address, operation2, await chainId()))
    })
  })

  describe('validateUserOp', () => {
    it('should revert if signature data is not present', async () => {
      const { eip4337Safe } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: AddressZero })
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature: '0x',
      })

      await expect(eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, '0')).to.be.revertedWith('Invalid signature')
    })

    it('should revert if signatures are invalid', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user2, safeOpHash)])

      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })

      await expect(eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, 0)).to.be.revertedWith('Invalid signature')
    })

    it("should revert if the operation nonce doesn't match current safe nonce", async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '1', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })

      await expect(eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, 0)).to.be.reverted
    })

    it("should revert if msg.sender doesn't match signed entry point", async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const user2Safe = await eip4337Safe.connect(user2)

      await expect(user2Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, 0)).to.be.reverted
    })

    it('should revert if the entrypoint asks for a pre-fund larger than defined in the UserOperation', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = BigNumber.from(getRequiredPrefund(userOp)).add(1337)

      await expect(eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)).to.be.reverted
    })

    it('should revert if called not through the safe', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)
      const validateUserOpData = eip4337Safe.interface.encodeFunctionData('validateUserOp', [
        userOp,
        `0x${'0'.repeat(64)}`,
        requiredPrefund,
      ])

      await expect(
        user1.sendTransaction({
          to: eip4337Diatomic.address,
          data: validateUserOpData,
        }),
      ).to.be.revertedWith('InvalidCaller()')
    })

    it('should send a pre-fund if signatures are valid', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()
      expect(await hre.ethers.provider.getBalance(eip4337Safe.address)).to.equal(parseEther('0'))
      await user1.sendTransaction({ to: eip4337Safe.address, value: parseEther('1') })

      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)

      const entryPointPreCallBalance = await hre.ethers.provider.getBalance(user1.address)
      expect(await hre.ethers.provider.getBalance(eip4337Safe.address)).to.equal(parseEther('1'))
      const txReceipt = await (await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)).wait(1)
      const gasSpent = txReceipt.gasUsed.mul(txReceipt.effectiveGasPrice)
      expect(await hre.ethers.provider.getBalance(eip4337Safe.address)).to.equal(parseEther('1').sub(requiredPrefund))
      expect(await hre.ethers.provider.getBalance(user1.address)).to.equal(entryPointPreCallBalance.add(requiredPrefund).sub(gasSpent))
    })

    it('should increase the nonce', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      expect(await eip4337Safe.safeNonces(eip4337Safe.address)).to.equal(0)
      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)

      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)
      expect(await eip4337Safe.safeNonces(eip4337Safe.address)).to.equal(1)
    })

    it('should mark the transaction as ready to be executed', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()

      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(`0x${'0'.repeat(64)}`)
      const safeOp = buildSafeUserOp({ safe: eip4337Safe.address, nonce: '0', entryPoint: user1.address })
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)
      const expectedIntermediateTxHash = calculateIntermediateTxHash(userOp, user1.address, await chainId())

      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)

      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(expectedIntermediateTxHash)
    })
  })

  describe('execTransaction', () => {
    it('should revert if the transaction hash was not marked as ready to be executed', async () => {
      const { eip4337Safe, storageSetter } = await setupTests()

      const safeOp = buildSafeUserOpContractCall(storageSetter, 'setStorage', ['0xbaddad'], eip4337Safe.address, '0', '0', AddressZero)

      await expect(user1.sendTransaction({ to: eip4337Safe.address, data: safeOp.callData })).to.be.reverted
    })

    it('should revert if called not by the entry point from validateUserOp', async () => {
      const { eip4337Safe, storageSetter, eip4337Diatomic } = await setupTests()

      const safeOp = buildSafeUserOpContractCall(storageSetter, 'setStorage', ['0xbaddad'], eip4337Safe.address, '0', '0', user1.address)
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)
      const expectedIntermediateTxHash = calculateIntermediateTxHash(userOp, user1.address, await chainId())

      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)
      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(expectedIntermediateTxHash)

      await expect(user2.sendTransaction({ to: eip4337Safe.address, data: userOp.callData })).to.be.reverted
    })

    it('should execute native token transfers', async () => {
      const { eip4337Safe, eip4337Diatomic } = await setupTests()
      await user2.sendTransaction({ to: eip4337Safe.address, value: parseEther('6') })

      const safeOp = buildSafeUserOpTransaction(eip4337Safe.address, AddressZero, parseEther('5'), '0x', '0', user1.address)
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)

      const recipientBalanceBefore = await hre.ethers.provider.getBalance(AddressZero)
      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)
      await user1.sendTransaction({ to: eip4337Safe.address, data: userOp.callData, gasLimit: userOp.callGas })

      const recipientBalanceAfter = await hre.ethers.provider.getBalance(AddressZero)
      expect(recipientBalanceAfter).to.equal(recipientBalanceBefore.add(parseEther('5')))
    })

    it('should execute contract calls', async () => {
      const { eip4337Safe, eip4337Diatomic, storageSetter } = await setupTests()

      const safeOp = buildSafeUserOpContractCall(storageSetter, 'setStorage', ['0xbaddad'], eip4337Safe.address, '0', '0', user1.address)
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)
      const expectedIntermediateTxHash = calculateIntermediateTxHash(userOp, user1.address, await chainId())

      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)
      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(expectedIntermediateTxHash)

      await user1.sendTransaction({ to: eip4337Safe.address, data: userOp.callData, gasLimit: userOp.callGas })

      await expect(
        await hre.ethers.provider.getStorageAt(eip4337Safe.address, '0x7373737373737373737373737373737373737373737373737373737373737373'),
      ).to.be.eq('0x' + ''.padEnd(64, '0'))

      await expect(
        await hre.ethers.provider.getStorageAt(storageSetter.address, '0x7373737373737373737373737373737373737373737373737373737373737373'),
      ).to.be.eq('0x' + 'baddad'.padEnd(64, '0'))
    })

    it('should reset transactionsReadyToExecute mapping after executing a transaction', async () => {
      const { eip4337Safe, eip4337Diatomic, storageSetter } = await setupTests()

      const safeOp = buildSafeUserOpContractCall(storageSetter, 'setStorage', ['0xbaddad'], eip4337Safe.address, '0', '0', user1.address)
      const safeOpHash = calculateSafeOperationHash(eip4337Diatomic.address, safeOp, await chainId())
      const signature = buildSignatureBytes([await signHash(user1, safeOpHash)])
      const userOp = buildUserOperationFromSafeUserOperation({
        safeAddress: eip4337Safe.address,
        safeOp,
        signature,
      })
      const requiredPrefund = getRequiredPrefund(userOp)
      const expectedIntermediateTxHash = calculateIntermediateTxHash(userOp, user1.address, await chainId())

      await eip4337Safe.validateUserOp(userOp, `0x${'0'.repeat(64)}`, requiredPrefund)
      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(expectedIntermediateTxHash)

      await user1.sendTransaction({ to: eip4337Safe.address, data: userOp.callData, gasLimit: userOp.callGas })

      expect(await eip4337Safe.transactionsReadyToExecute(eip4337Safe.address)).to.equal(`0x${'0'.repeat(64)}`)
    })
  })
})
