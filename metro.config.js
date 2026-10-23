const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
// Keep exports and native bundles responsive on small Windows development machines.
config.maxWorkers = 2;
module.exports = config;
