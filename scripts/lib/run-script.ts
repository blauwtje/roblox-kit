import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

type ParsedValues = ReturnType<typeof parseArgs<{ options: ParseArgsOptionsConfig }>>["values"];

export interface ScriptDefinition {
  name: string;
  usage: string;
  options?: ParseArgsOptionsConfig;
  run: (values: ParsedValues) => Promise<number> | number;
}

export async function runScript(definition: ScriptDefinition): Promise<void> {
  const options: ParseArgsOptionsConfig = {
    ...definition.options,
    help: { type: "boolean", short: "h" },
  };
  let values: ParsedValues;
  try {
    values = parseArgs({ options, allowPositionals: false }).values;
  } catch (error) {
    console.error(`${definition.name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(definition.usage);
    process.exitCode = 2;
    return;
  }
  if (values.help === true) {
    console.log(definition.usage);
    return;
  }
  try {
    const status = await definition.run(values);
    if (status !== 0) {
      process.exitCode = status;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
