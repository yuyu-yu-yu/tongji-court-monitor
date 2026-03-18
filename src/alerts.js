export function bell(count = 1) {
  for (let index = 0; index < count; index += 1) {
    process.stdout.write("\u0007");
  }
}

export function formatBanner(message) {
  return `\n=== ${message} ===\n`;
}

