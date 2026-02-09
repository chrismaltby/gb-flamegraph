/**
 * Core benchmark runner
 * Platform-agnostic benchmarking engine that works in both Node.js and browser
 */

const GameboyJS = require("../gameboy");
const {
  INTERRUPTS,
  parseNoi,
  generateFunctionRegions,
} = require("./noi-parser");
const { parseInput } = require("./input-parsers");
const {
  createSpeedscopeTrace,
  addOpenEvent,
  addCloseEvent,
  addCapture,
  finalizeTrace,
  getEventsBetween,
} = require("./speedscope");

const CYCLES_PER_FRAME = 70256;
const IGNORE_SYMBOLS = [".add_VBL", ".add_int", "_display_off"];
const RETI = 0xd9;

class BenchmarkRunner {
  /**
   * Create a new benchmark runner
   * @param {object} options - Configuration options
   * @param {Uint8Array|Buffer} options.romData - ROM file data
   * @param {string} [options.noiData] - NOI file content (optional)
   * @param {Array|string} [options.inputData] - Input events (JSON array or string)
   * @param {Function} options.createCanvas - Canvas factory function (width, height) => canvas
   * @param {number} [options.startFrame=0] - Start frame for recording (frames before this are skipped)
   * @param {number} [options.frames=60] - Number of frames to process after startFrame
   * @param {string} [options.captureMode='all'] - Capture mode: 'all', 'exit', 'none'
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   * @param {Array<number>} [options.disabledInterrupts=[]] - Interrupt indices to disable
   * @param {Function} [options.onProgress] - Progress callback (frame, total) => void
   * @param {Function} [options.onFrameComplete] - Frame complete callback (frameIndex, canvas) => Promise<capture>
   * @param {Function} [options.logger] - Custom logger function
   */
  constructor(options) {
    this.romData = options.romData;
    this.noiData = options.noiData;
    this.inputData = options.inputData;
    this.createCanvas = options.createCanvas;
    this.startFrame = options.startFrame || 0;
    this.frames = options.frames || 60;
    this.captureMode = options.captureMode || "all";
    this.verbose = options.verbose || false;
    this.disabledInterrupts = options.disabledInterrupts || [];
    this.onProgress = options.onProgress;
    this.onFrameComplete = options.onFrameComplete;
    this.logger = options.logger || console.log;

    this.noiLookup = [];
    this.functionRegions = [];
    this.regionsByBank = {};
    this.noiIndex = {};
    this.currentFnRegion = null;
    this.framesElapsed = 0;
    this.fnStack = [];
    this.interruptStack = [];
    this.speedscope = null;
    this.canvas = null;
    this.gb = null;
  }

  /**
   * Initialize the benchmark
   */
  initialize() {
    // Parse NOI data if provided
    if (this.noiData) {
      this.noiLookup = parseNoi(this.noiData);
      this.functionRegions = generateFunctionRegions(this.noiLookup);

      for (const region of this.functionRegions) {
        if (!this.regionsByBank[region.bank]) {
          this.regionsByBank[region.bank] = [];
        }
        this.regionsByBank[region.bank].push(region);
      }

      for (let i = 0; i < this.noiLookup.length; i++) {
        this.noiIndex[this.noiLookup[i].symbol] = i;
      }
    }

    // Parse input data if provided
    if (this.inputData) {
      this.inputData = parseInput(this.inputData);
    }

    // Setup disabled interrupts
    GameboyJS.DISABLED_INTERRUPTS = [...this.disabledInterrupts];

    // Create speedscope trace
    this.speedscope = createSpeedscopeTrace(this.noiLookup);

    // Create canvas and gameboy instance
    this.canvas = this.createCanvas(160, 144);
    this.gb = new GameboyJS.Gameboy(this.canvas);
    this.gb.cpu.isPaused = true;

    // Setup hooks
    this.setupHooks();

    // Load ROM
    this.gb.startRom({ data: this.romData });
  }

  /**
   * Setup CPU hooks for profiling
   */
  setupHooks() {
    this.gb.cpu.onAfterInstruction = (opcode) => {
      const pc = this.gb.cpu.r.pc;

      if (opcode === RETI) {
        this.popInterrupts();
        return;
      }

      const bank = this.gb.cpu.memory.mbc.romBankNumber;
      const newFn = this.getCurrentFunctionRegion(pc, bank);

      if (!newFn || newFn === this.currentFnRegion) {
        return;
      }

      if (IGNORE_SYMBOLS.includes(newFn.symbol)) {
        return;
      }

      // Entering a new function at its start
      if (newFn && pc === newFn.addr) {
        this.pushFrame(newFn);
        this.currentFnRegion = newFn;
        return;
      }

      // Jumped to mid-function
      if (newFn && pc !== newFn.addr) {
        if (this.fnStackContains(newFn)) {
          this.popFramesUntil(newFn);
        } else {
          if (this.interruptStack.length > 0) {
            return;
          }
          if (pc >= 0x4000) {
            this.pushFrame(newFn);
          }
        }
        this.currentFnRegion = newFn;
        return;
      }

      this.currentFnRegion = null;
    };

    this.gb.cpu.onInterrupt = (interrupt) => {
      const clockNow = this.getGBTime();

      this.popInterrupts();
      this.interruptStack.push(INTERRUPTS[interrupt]);

      this.fnStack.push({
        symbol: INTERRUPTS[interrupt].symbol,
        addr: INTERRUPTS[interrupt].addr,
        clock: clockNow,
        childPushed: false,
        openPrinted: false,
        indent: this.fnStack.length,
      });

      addOpenEvent(
        this.speedscope,
        this.noiIndex[INTERRUPTS[interrupt].symbol],
        clockNow,
      );
    };
  }

  /**
   * Get current GB time in cycles
   * @returns {number}
   */
  getGBTime() {
    return this.gb.cpu.clock.c + this.framesElapsed * CYCLES_PER_FRAME;
  }

  /**
   * Log message if verbose mode is enabled
   */
  log(...args) {
    if (this.verbose && this.logger) {
      this.logger(...args);
    }
  }

  /**
   * Get current function region for PC and bank
   */
  getCurrentFunctionRegion(pc, bank) {
    if (this.currentFnRegion) {
      const fn = this.currentFnRegion;
      if (pc >= fn.addr && pc <= fn.end) {
        if (pc < 0x4000 || fn.bank === bank) {
          return fn;
        }
      }
    }

    const targetBank = pc < 0x4000 ? 0 : bank;
    const bankRegions = this.regionsByBank[targetBank];
    if (!bankRegions) return undefined;
    return bankRegions.find((fn) => pc >= fn.addr && pc <= fn.end);
  }

  /**
   * Push a frame onto the call stack
   */
  pushFrame(fn) {
    const clockNow = this.getGBTime();

    const parent = this.fnStack[this.fnStack.length - 1];
    if (parent) {
      parent.childPushed = true;
      if (!parent.openPrinted) {
        const prefix = "|   ".repeat(Math.max(0, parent.indent));
        this.log(`${prefix}+- ${parent.symbol}`);
        parent.openPrinted = true;
      }
    }

    this.fnStack.push({
      symbol: fn.symbol,
      addr: fn.addr,
      clock: clockNow,
      childPushed: false,
      openPrinted: false,
      indent: this.fnStack.length,
    });

    addOpenEvent(this.speedscope, this.noiIndex[fn.symbol], clockNow);
  }

  /**
   * Check if function is on the stack
   */
  fnStackContains(searchFn) {
    for (const fn of this.fnStack) {
      if (fn.symbol === searchFn.symbol) {
        return true;
      }
    }
    return false;
  }

  /**
   * Pop frames until reaching the specified function
   */
  popFramesUntil(fn) {
    const clockNow = this.getGBTime();

    if (fn && !this.fnStackContains(fn)) {
      return;
    }

    while (
      this.fnStack.length > 0 &&
      this.fnStack[this.fnStack.length - 1]?.symbol !== fn?.symbol
    ) {
      const poppedFn = this.fnStack.pop();
      const cycles = clockNow - poppedFn.clock;

      addCloseEvent(
        this.speedscope,
        this.noiIndex[poppedFn.symbol],
        Math.max(clockNow, poppedFn.clock),
        poppedFn.clock,
      );

      const prefix = "|   ".repeat(Math.max(0, poppedFn.indent));
      this.log(`${prefix}└- ${poppedFn.symbol} ${cycles}`);
    }
  }

  /**
   * Pop frames including the specified function
   */
  popFramesIncluding(fn) {
    const clockNow = this.getGBTime();

    if (fn && !this.fnStackContains(fn)) {
      return;
    }

    while (this.fnStack.length > 0) {
      const poppedFn = this.fnStack.pop();
      const cycles = clockNow - poppedFn.clock;

      addCloseEvent(
        this.speedscope,
        this.noiIndex[poppedFn.symbol],
        clockNow,
        poppedFn.clock,
      );

      const prefix = "|   ".repeat(Math.max(0, poppedFn.indent));
      this.log(`${prefix}└- ${poppedFn.symbol} ${cycles}`);

      if (poppedFn.symbol === fn?.symbol) {
        break;
      }
    }
  }

  /**
   * Pop all interrupt frames
   */
  popInterrupts() {
    if (this.interruptStack.length > 0) {
      while (this.interruptStack.length > 0) {
        const interrupted = this.interruptStack.pop();
        if (interrupted) {
          this.popFramesIncluding(interrupted);
        }
      }
    }
  }

  /**
   * Generate frame report
   */
  logFrameReport(start, end, frameIndex) {
    if (!this.verbose) return;

    this.log("");
    this.log(
      "- FRAME",
      frameIndex,
      "REPORT -------------------------------------------------------",
    );

    const BAR_WIDTH = 30;
    const events = getEventsBetween(
      this.speedscope.profiles[0].events,
      start,
      end,
    );

    const frameMap = new Map();

    for (const e of events) {
      const frame = this.speedscope.shared.frames[e.frame];
      const name = frame.name;
      const duration = Math.min(e.end, end) - Math.max(e.start, start);

      if (!frameMap.has(name)) {
        frameMap.set(name, { name, duration: 0 });
      }

      frameMap.get(name).duration += duration;
    }

    const frameStats = [...frameMap.values()].sort(
      (a, b) => b.duration - a.duration,
    );

    const longestSymbolLength = Math.max(
      ...this.noiLookup.map((f) => f.symbol.length),
    );

    for (const { name, duration } of frameStats) {
      const clampedDuration = Math.min(duration, CYCLES_PER_FRAME);
      const filledLength = Math.round(
        (clampedDuration / CYCLES_PER_FRAME) * BAR_WIDTH,
      );
      const bar = `|${"#".repeat(filledLength)}${"-".repeat(
        BAR_WIDTH - filledLength,
      )}| (${frameIndex})`;
      const paddedName = name.padEnd(longestSymbolLength);
      const durStr = String(duration).padStart(8);
      this.log(`* ${paddedName} ${durStr} ${bar}`);
    }

    this.log(
      "---------------------------------------------------------------------------",
    );
    this.log("");
  }

  /**
   * Run the benchmark
   * @returns {Promise<{speedscope: object, captures: Array}>} Benchmark results
   */
  async run() {
    this.initialize();

    const captures = [];
    const totalFrames = this.startFrame + this.frames;
    let captureStartTime = 0;

    for (let i = 0; i < totalFrames; i++) {
      const isRecording = i >= this.startFrame;
      // const isRecording = true;

      if (isRecording) {
        this.log(
          "= FRAME",
          i,
          "==================================================================",
        );
        this.log("");
      }

      // Process input
      if (this.inputData) {
        const frameInput = this.inputData.find((entry) => entry.frame === i);
        if (frameInput) {
          for (const key of frameInput.release || []) {
            this.gb.input.releaseKey(key);
          }
          for (const key of frameInput.press || []) {
            this.gb.input.pressKey(key);
          }
        }
      }

      const frameStartTime = this.getGBTime();

      // Execute frame
      this.gb.cpu.frame();
      this.framesElapsed++;

      // Progress callback (report total progress)
      if (this.onProgress) {
        this.onProgress(i + 1, totalFrames);
      }

      // Only capture/record if we're past the start frame
      if (isRecording) {
        if (captureStartTime === 0) {
          captureStartTime = frameStartTime;
        }

        // Capture frame
        if (this.captureMode === "all" && this.onFrameComplete) {
          const capture = await this.onFrameComplete(i, this.canvas);
          if (capture) {
            captures.push(capture);
            addCapture(this.speedscope, capture.src, frameStartTime, i);
          }
        } else if (
          this.captureMode === "exit" &&
          i === totalFrames - 1 &&
          this.onFrameComplete
        ) {
          const capture = await this.onFrameComplete(i, this.canvas);
          if (capture) {
            captures.push(capture);
          }
        }
        this.logFrameReport(
          frameStartTime,
          this.getGBTime(),
          this.framesElapsed - 1,
        );
      }
    }

    // Finalize
    this.popFramesUntil();
    finalizeTrace(this.speedscope, captureStartTime);

    return {
      speedscope: this.speedscope,
      captures,
    };
  }
}

module.exports = BenchmarkRunner;
