import hre, { deployments } from 'hardhat'
import { Signer, Contract } from 'ethers'
import solc from 'solc'

export const eip4337DiatomicDeployment = async () => {
  return await deployments.get('SafeEIP4337Diatomic')
}

export const eip4337ModuleDeployment = async () => {
  return await deployments.get('EIP4337Module')
}

export const eip4337DiatomicContract = async () => {
  return await hre.ethers.getContractFactory('SafeEIP4337Diatomic')
}

export const eip4337DiatomicExposedDeployment = async () => {
  return await deployments.get('DiatomicExposed')
}

export const eip4337DiatomicExposedContract = async () => {
  return await hre.ethers.getContractFactory('DiatomicExposed')
}

export const getSafeAtAddress = async (address: string) => {
  const safeMock = await hre.ethers.getContractFactory('GnosisSafeMock')

  return safeMock.attach(address)
}

export const getTestSafe = async (deployer: Signer, fallbackHandler?: string, moduleAddr?: string) => {
  const safeFactory = await hre.ethers.getContractFactory('GnosisSafeMock')
  const factoryWithDeployer = safeFactory.connect(deployer)
  const safe = factoryWithDeployer.deploy(fallbackHandler, moduleAddr)

  return safe
}

export const getEip4337Diatomic = async () => {
  return (await eip4337DiatomicContract()).attach((await eip4337DiatomicDeployment()).address)
}

export const getEip4337DiatomicExposed = async (deployer: Signer) => {
  const factory = await eip4337DiatomicExposedContract()
  const factoryWithDeployer = factory.connect(deployer)
  const eip4337DiatomicExposed = factoryWithDeployer.deploy()

  return eip4337DiatomicExposed
}

export const getTestStorageSetter = async (signer: Signer) => {
  const factory = await hre.ethers.getContractFactory('StorageSetter')
  const factoryWithDeployer = factory.connect(signer)
  const setter = await factoryWithDeployer.deploy()

  return setter
}

export const getStorageSetterAtAddress = async (address: string) => {
  const storageSetter = await hre.ethers.getContractFactory('StorageSetter')

  return storageSetter.attach(address)
}

export const compile = async (source: string) => {
  const input = JSON.stringify({
    language: 'Solidity',
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode'],
        },
      },
    },
    sources: {
      'tmp.sol': {
        content: source,
      },
    },
  })
  const solcData = await solc.compile(input)
  const output = JSON.parse(solcData)
  if (!output['contracts']) {
    console.log(output)
    throw Error('Could not compile contract')
  }
  const fileOutput = output['contracts']['tmp.sol']
  const contractOutput = fileOutput[Object.keys(fileOutput)[0]]
  const abi = contractOutput['abi']
  const data = '0x' + contractOutput['evm']['bytecode']['object']
  return {
    data: data,
    interface: abi,
  }
}

export const deployContract = async (deployer: Signer, source: string): Promise<Contract> => {
  const output = await compile(source)
  const transaction = await deployer.sendTransaction({ data: output.data, gasLimit: 6000000 })
  const receipt = await transaction.wait()
  return new Contract(receipt.contractAddress, output.interface, deployer)
}
