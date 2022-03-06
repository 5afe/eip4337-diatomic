import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deployer } = await getNamedAccounts()
  const { deploy } = deployments

  await deploy('SafeEIP4337Diatomic', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true,
  })
}

deploy.tags = ['eip4337', 'l2-suite', 'main-suite']
export default deploy
