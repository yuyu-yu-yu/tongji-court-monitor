#!/usr/bin/env node
import { loadCourtWatchConfig, loadDamaiConfig } from "./config.js";
import { watchCourts } from "./court-runner.js";
import { arm } from "./runner.js";

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const options = parseArgs(rest);

  if (command === "arm") {
    const config = await loadDamaiConfig(options.config);
    const result = await arm(config);
    console.log(`Finished in state: ${result.state}`);
    console.log(`Log file: ${result.logPath}`);
    return;
  }

  if (command === "watch-courts") {
    const config = await loadCourtWatchConfig(options.config);
    await watchCourts(config);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      options.config = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node ./src/cli.js arm --config ./config/damai.config.json
  node ./src/cli.js watch-courts --config ./config/tongji-courts.config.json
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});