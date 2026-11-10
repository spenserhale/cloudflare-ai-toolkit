import { AuthUsageError } from "./auth.js";

export function stdinIsInteractive(): boolean {
  return Boolean(process.stdin.isTTY && typeof process.stdin.setRawMode === "function");
}

/**
 * Read one line from the terminal without echoing it. The label goes to
 * stderr so stdout stays clean for structured output.
 */
export function promptHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(label);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      // A paste arrives as one multi-character chunk, so walk every character.
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") return finish();
        if (char === "\u0003") return finish(new AuthUsageError("Cancelled; nothing was stored"));
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

/** Read all of stdin, for piped secrets (`... | cloudflare auth set api-token --stdin`). */
export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
