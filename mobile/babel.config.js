// Babel config for Expo SDK 54.
//
// Since SDK 50, babel-preset-expo automatically includes the Reanimated
// worklets babel plugin — we no longer need to add it explicitly. Adding
// it manually with Reanimated 4 actually causes a duplicate-transform
// error.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
