module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved its worklet transform into react-native-worklets. Pointing at the old
    // `react-native-reanimated/plugin` path still "works" - it re-exports - but it is deprecated
    // and warns on every build, so it is named where it actually lives.
    plugins: ['react-native-worklets/plugin'],
  };
};
