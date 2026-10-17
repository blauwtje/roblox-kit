import { readFileSync } from "node:fs";

const requireLine =
  /^([ \t]*)local[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*require\("(\.{1,2}\/[^"]+)"\)[ \t]*$/gm;

interface InlineContext {
  fileUrl: URL;
  chain: string[];
  scopes: Map<string, string>[];
}

function moduleUrl(relativePath: string, fileUrl: URL): URL {
  const withExtension = /\.luau?$/.test(relativePath) ? relativePath : `${relativePath}.luau`;
  return new URL(withExtension, fileUrl);
}

function readModule(url: URL, path: string, context: InlineContext): string {
  try {
    return readFileSync(url, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot inline require("${path}") from ${context.fileUrl.href}: ${String(error)}`,
      { cause: error },
    );
  }
}

function inlineInto(source: string, context: InlineContext): string {
  return source.replace(requireLine, (...match: string[]) => {
    const [, indent = "", name = "", path = ""] = match;
    const url = moduleUrl(path, context.fileUrl);
    const key = url.href;
    if (context.chain.includes(key)) {
      throw new Error(`Luau require cycle: ${[...context.chain, key].join(" -> ")}`);
    }
    const existing = context.scopes
      .map((scope) => scope.get(key))
      .find((bound) => bound !== undefined);
    if (existing !== undefined) {
      return `${indent}local ${name} = ${existing}`;
    }
    const body = readModule(url, path, context);
    const inner = inlineInto(body, {
      fileUrl: url,
      chain: [...context.chain, key],
      scopes: [new Map<string, string>(), ...context.scopes],
    });
    context.scopes[0]?.set(key, name);
    return `${indent}local ${name} = (function()\n${inner}\nend)()`;
  });
}

/**
 * Replaces each `local X = require("<relative path>")` line with `local X = (function() <module
 * body> end)()`, recursively. A module required again where its first binding is still in scope
 * becomes `local Y = X` instead of a second copy. Throws when a module file is missing or the
 * requires form a cycle.
 */
export function inlineRequires(source: string, fileUrl: URL): string {
  return inlineInto(source, { fileUrl, chain: [], scopes: [new Map<string, string>()] });
}
