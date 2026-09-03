const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

const defaultConfig = getDefaultConfig(__dirname);

// Add ONNX model file extensions so Metro bundles them for iOS (Android uses
// aaptOptions noCompress; iOS reads from MainBundlePath via react-native-fs)
const config = {
  resolver: {
    assetExts: [...defaultConfig.resolver.assetExts, 'onnx', 'data'],
  },
};

module.exports = mergeConfig(defaultConfig, config);
