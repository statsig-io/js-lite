#!/usr/bin/env node

const fs = require('fs');

const path = 'build/statsig-prod-web-sdk.js';
const stats = fs.statSync(path);

if (stats.size > 81200) {
  throw 'Error: Build has grown bigger than 80kb';
}

console.log(`Build size (${stats.size} bytes)`);
