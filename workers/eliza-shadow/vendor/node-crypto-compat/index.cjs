// This worker runs only in Node. Use its maintained crypto implementation instead
// of installing a browser polyfill and its unpatched elliptic dependency.
module.exports = require("node:crypto");
