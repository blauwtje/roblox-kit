import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

/** The reviewer's whole JSON reply has to fit; images are read from disk, not sent back. */
const replyBufferBytes = 10 * 1024 * 1024;

/** One image the reviewer reads: the file to copy and the name it has in the reviewer's folder. */
export interface ReviewerImage {
  path: string;
  name: string;
}

export interface ReviewerRequest<Schema extends z.ZodType> {
  /** Names the reviewer in the error of a failed run, such as `quality`. */
  reviewer: string;
  /** What the reviewer answers; its JSON Schema goes to `claude --json-schema`. */
  schema: Schema;
  images: ReviewerImage[];
  /** The brief the brief's own text names `images` by. */
  brief: string;
  timeoutMs: number;
}

/** The answer's JSON Schema for `claude --json-schema`, which rejects zod's `$schema` key. */
function answerJsonSchema(schema: z.ZodType): string {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema) };
  delete jsonSchema["$schema"];
  return JSON.stringify(jsonSchema);
}

/**
 * Asks a fresh headless Claude Code session, which can only read, to answer `brief` about `images`. The
 * images are copied into an empty temporary folder under their given names, so neither the repository nor
 * the original file names can give anything away; the folder is removed afterwards. Throws when the run
 * fails, times out or answers off-schema.
 */
export async function askHeadlessReviewer<Schema extends z.ZodType>(
  request: ReviewerRequest<Schema>,
): Promise<z.output<Schema>> {
  const folder = await mkdtemp(join(tmpdir(), `roblox-kit-${request.reviewer}-review-`));
  try {
    await Promise.all(
      request.images.map((image) => copyFile(image.path, join(folder, image.name))),
    );
    // The brief goes in on stdin: `-p` with no prompt argument reads it from there.
    const pending = run(
      "claude",
      [
        "-p",
        "--tools",
        "Read",
        "--allowedTools",
        "Read",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--json-schema",
        answerJsonSchema(request.schema),
      ],
      { cwd: folder, timeout: request.timeoutMs, maxBuffer: replyBufferBytes },
    );
    pending.child.stdin?.end(request.brief);
    const { stdout } = await pending;
    const reply = z
      .object({ is_error: z.boolean(), result: z.string(), structured_output: z.unknown() })
      .parse(JSON.parse(stdout));
    if (reply.is_error) {
      throw new Error(`The ${request.reviewer} reviewer failed: ${reply.result}`);
    }
    return request.schema.parse(reply.structured_output);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
