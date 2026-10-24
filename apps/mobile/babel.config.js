// SPDX-License-Identifier: AGPL-3.0-or-later
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // PowerSync uses async iterators for watched queries and the upload queue.
    plugins: ["@babel/plugin-transform-async-generator-functions"],
  };
};
