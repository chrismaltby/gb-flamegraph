#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { program } = require("commander");
const { createCanvas } = require("canvas");
const BenchmarkRunner = require("./core/benchmark");
const { INTERRUPTS } = require("./core/noi-parser");

program
  .name("gb-flamegraph")
  .description("A tool for creating flame graphs from Game Boy ROMs")
  .requiredOption("-r, --rom <filename>", "Path to the ROM file")
  .option("-i, --input <inputfile>", "Path to the input file")
  .option("-e, --export <filename>", "Path to export results to")
  .option(
    "-s, --start-frame <number>",
    "Start frame for recording",
    (value) => parseInt(value, 10),
    0,
  )
  .option(
    "-f, --frames <number>",
    "Number of frames to process after start frame",
    (value) => parseInt(value, 10),
    60,
  )
  .option(
    "-c, --capture <mode>",
    'Capture mode ("all", "exit", "none")',
    (value) => {
      const allowed = ["all", "exit", "none"];
      if (!allowed.includes(value)) {
        throw new Error(`Invalid value for --capture: ${value}`);
      }
      return value;
    },
    "all",
  )
  .option(
    "-d, --disable-interrupts <list>",
    "Disable interrupts during benchmarking",
  )
  .option("-v, --verbose", "Enable verbose call trace output")
  .helpOption("-h, --help", "Display help for command")
  .parse(process.argv);

const options = program.opts();

// Load ROM data
const romData = fs.readFileSync(options.rom);

// Load NOI data if available
let noiData = null;
try {
  noiData = fs.readFileSync(options.rom.replace(/\.(gbc|gb)/i, ".noi"), "utf8");
} catch (e) {
  console.error("No .noi file found for ROM");
}

// Load input data if provided
let inputData = null;
if (options.input) {
  const inputFile = fs.readFileSync(options.input, "utf-8");
  inputData = JSON.parse(inputFile);
}

// Parse disabled interrupts
const disabledInterrupts = [];
if (options.disableInterrupts) {
  const disableList = options.disableInterrupts
    .split(",")
    .map((name) => name.trim().toUpperCase());
  for (let i = 0; i < INTERRUPTS.length; i++) {
    const interrupt = INTERRUPTS[i];
    if (disableList.includes(interrupt.name)) {
      disabledInterrupts.push(i);
    }
  }
}

// Setup export paths
let exportPath = null;
let capturePath = null;

if (options.export) {
  exportPath = path.resolve(options.export);
  capturePath = path.join(exportPath, "captures");
  if (options.capture === "all") {
    fs.mkdirSync(capturePath, { recursive: true });
  } else {
    fs.mkdirSync(exportPath, { recursive: true });
  }
}

// Save frame as PNG
const saveFramePng = async (canvas, outPath) => {
  const out = fs.createWriteStream(outPath);
  const stream = canvas.createPNGStream();
  stream.pipe(out);
  await once(out, "finish");
};

// Main execution
const main = async () => {
  const runner = new BenchmarkRunner({
    romData,
    noiData,
    inputData,
    createCanvas: (w, h) => createCanvas(w, h),
    startFrame: options.startFrame,
    frames: options.frames,
    captureMode: options.capture,
    verbose: options.verbose,
    disabledInterrupts,
    onFrameComplete: async (frameIndex, canvas) => {
      if (!exportPath) return null;

      if (options.capture === "all") {
        const filename = `frame_${String(frameIndex).padStart(4, "0")}.png`;
        const outPath = path.join(capturePath, filename);
        await saveFramePng(canvas, outPath);
        return { src: `captures/${filename}` };
      } else if (options.capture === "exit") {
        const outPath = path.join(exportPath, `final_frame.png`);
        await saveFramePng(canvas, outPath);
        return { src: `final_frame.png` };
      }
      return null;
    },
  });

  const { speedscope } = await runner.run();

  // Export results if export path specified
  if (exportPath) {
    const speedscopePath = path.join(exportPath, "speedscope.json");
    fs.writeFileSync(speedscopePath, JSON.stringify(speedscope, null, 4));

    if (options.capture === "all") {
      const htmlPath = path.join(exportPath, "index.html");
      const htmlTemplate = fs
        .readFileSync(path.join(__dirname, "template/index.html"), "utf8")
        .replace("|SPEEDSCOPE_DATA|", JSON.stringify(speedscope));
      fs.writeFileSync(htmlPath, htmlTemplate);
    }
  }

  process.exit(0);
};

main().catch(console.error);
