import { z } from "zod";
import { resolveName } from "../shared/resolve-name.ts";

/** The switches of `build_map` that add scenery on their own; a prompt has to ask for each one. */
export const roughPromptSwitches = ["npcs", "clutter", "signage", "motion"] as const;

export const roughPromptFixtureSchema = z.strictObject({
  prompt: z.string().min(1),
  names: z.array(z.string().min(1)),
  switches: z.array(z.enum(roughPromptSwitches)),
});
export type RoughPromptFixture = z.infer<typeof roughPromptFixtureSchema>;

/** What the headless session answers: the `build_map` input it would send and the questions it asks. */
export const roughPromptReplySchema = z.strictObject({
  buildMapInput: z.record(z.string(), z.unknown()),
  questions: z.array(z.string()),
});
export type RoughPromptReply = z.infer<typeof roughPromptReplySchema>;

export interface RoughPromptResult {
  pass: boolean;
  problems: string[];
}

function roomName(room: unknown): string[] {
  const name = (room as { name?: unknown } | null)?.name;
  return typeof name === "string" ? [name] : [];
}

function producedNames(input: Record<string, unknown>): string[] {
  const rooms = Array.isArray(input["rooms"]) ? (input["rooms"] as unknown[]) : [];
  const preset = (input["style"] as { preset?: unknown } | undefined)?.preset;
  return [...rooms.flatMap(roomName), ...(typeof preset === "string" ? [preset] : [])];
}

function isOn(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

/** Passes when the input keeps every stated name, turns on only the asked-for switches and the reply asks at most one question. */
export function checkRoughPrompt(
  fixture: RoughPromptFixture,
  reply: RoughPromptReply,
): RoughPromptResult {
  const problems: string[] = [];
  const produced = producedNames(reply.buildMapInput);
  for (const stated of fixture.names) {
    try {
      resolveName(stated, produced, "name");
    } catch {
      problems.push(`dropped the stated name "${stated}"`);
    }
  }
  for (const key of roughPromptSwitches) {
    if (isOn(reply.buildMapInput[key]) && !fixture.switches.includes(key)) {
      problems.push(`turned on "${key}" without being asked`);
    }
  }
  if (reply.questions.length > 1) {
    problems.push(`asked ${String(reply.questions.length)} questions`);
  }
  return { pass: problems.length === 0, problems };
}
