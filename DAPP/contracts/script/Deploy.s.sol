// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Crowdfunding} from "../src/Crowdfunding.sol";

interface VmScript {
    function envAddress(string calldata name) external view returns (address);
    function envString(string calldata name) external view returns (string memory);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
    function serializeAddress(string calldata objectKey, string calldata valueKey, address value) external returns (string memory);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value) external returns (string memory);
    function serializeString(string calldata objectKey, string calldata valueKey, string calldata value) external returns (string memory);
    function serializeBool(string calldata objectKey, string calldata valueKey, bool value) external returns (string memory);
    function writeJson(string calldata json, string calldata path) external;
}

/// @notice Deploy and seed three local-only example projects.
contract DeployScript {
    VmScript private constant vm = VmScript(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external {
        address owner = vm.envAddress("ANVIL_ACCOUNT_0");
        address supporterA = vm.envAddress("ANVIL_ACCOUNT_1");
        address supporterB = vm.envAddress("ANVIL_ACCOUNT_2");

        vm.startBroadcast(owner);
        Crowdfunding crowdfunding = new Crowdfunding();
        uint256 active = crowdfunding.createProject(
            unicode"开源校园地图", unicode"为新生提供无障碍路线与校园设施导航。", 5 ether, 2 days, 1 days
        );
        uint256 success = crowdfunding.createProject(
            unicode"社区共享花园", unicode"改造闲置街角，为邻里提供共享种植空间。", 3 ether, 90, 1 days
        );
        uint256 failed = crowdfunding.createProject(
            unicode"独立短片计划", unicode"拍摄一部关于城市记忆的短片。", 10 ether, 90, 1 days
        );
        vm.stopBroadcast();

        string memory config = vm.serializeAddress("runtime", "contractAddress", address(crowdfunding));
        config = vm.serializeUint("runtime", "chainId", 31337);
        config = vm.serializeString("runtime", "rpcUrl", vm.envString("BROWSER_RPC_URL"));
        config = vm.serializeBool("runtime", "demoEnabled", true);
        config = vm.serializeString("runtime", "environment", "local");
        vm.writeJson(config, "out/deployment.json");

        vm.startBroadcast(supporterA);
        crowdfunding.contribute{value: 0.8 ether}(active);
        crowdfunding.contribute{value: 2 ether}(success);
        crowdfunding.contribute{value: 1 ether}(failed);
        vm.stopBroadcast();

        vm.startBroadcast(supporterB);
        crowdfunding.contribute{value: 1.5 ether}(success);
        vm.stopBroadcast();
    }
}
