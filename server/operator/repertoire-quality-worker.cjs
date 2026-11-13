require('tsx/cjs');
const { workerData } = require('node:worker_threads');
require(workerData.entry);
