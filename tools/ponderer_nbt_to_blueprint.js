#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { convertPondererNbtFileToBlueprint } = require("../src/survival/pondererBlueprint");

function printUsage() {
  console.log("Usage: node tools/ponderer_nbt_to_blueprint.js <input.nbt> <output.json> [--id=blueprint_id] [--name=Blueprint Name] [--style=style_name]");
}

function parseOptions(args) {
  return args.reduce((options, arg) => {
    if (!arg.startsWith("--")) return options;
    const [key, ...valueParts] = arg.slice(2).split("=");
    const value = valueParts.join("=");
    if (key && value) options[key] = value;
    return options;
  }, {});
}

async function main() {
  const [, , inputPath, outputPath, ...optionArgs] = process.argv;
  if (!inputPath || !outputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  const options = parseOptions(optionArgs);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Input file does not exist: ${resolvedInput}`);
    process.exitCode = 1;
    return;
  }

  const blueprint = await convertPondererNbtFileToBlueprint(resolvedInput, {
    id: options.id,
    name: options.name,
    style: options.style,
    source: "ponderer_nbt_import_cli"
  });

  await fs.promises.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.promises.writeFile(resolvedOutput, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");

  console.log(`Converted ${resolvedInput}`);
  console.log(`Wrote blueprint JSON to ${resolvedOutput}`);
  console.log(`Placements: ${blueprint.placements.length}`);
  console.log(`Route: ${blueprint.route.join(">")}`);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});