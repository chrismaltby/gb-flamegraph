/**
 * GB Flamegraph Web Application
 * Main application logic for browser-based benchmarking
 */

import BenchmarkRunner from "../../src/core/benchmark.js";
import { renderViewer } from "./viewer.js";

// State
let romData = null;
let noiData = null;
let inputData = null;
let benchmarkResults = null;

// DOM Elements
const uploadSection = document.getElementById("upload-section");
const resultsSection = document.getElementById("results-section");
const runBtn = document.getElementById("run-benchmark");
const backBtn = document.getElementById("back-btn");
const progressSection = document.getElementById("progress-section");
const progressFill = document.getElementById("progress-fill");
const progressText = document.getElementById("progress-text");

// File status elements
const romStatus = document.getElementById("rom-status");
const noiStatus = document.getElementById("noi-status");
const inputStatus = document.getElementById("input-status");

// Config inputs
const startFrameInput = document.getElementById("start-frame-input");
const framesInput = document.getElementById("frames-input");

/**
 * Setup drag and drop for file zones
 */
function setupDragAndDrop(dropZoneId, fileInputId, onFile) {
  const dropZone = document.getElementById(dropZoneId);
  const fileInput = document.getElementById(fileInputId);

  // Prevent default drag behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Highlight drop zone when item is dragged over it
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      dropZone.classList.remove("drag-over");
    });
  });

  // Handle dropped files
  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0], onFile, dropZone);
    }
  });

  // Handle file input change
  fileInput.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      handleFile(files[0], onFile, dropZone);
    }
  });

  // Click to browse
  dropZone.addEventListener("click", (e) => {
    if (!e.target.classList.contains("browse-btn")) {
      fileInput.click();
    }
  });
}

/**
 * Handle file upload
 */
async function handleFile(file, callback, dropZone) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    await callback(file, e.target.result);
    dropZone.classList.add("has-file");
    checkReadyToRun();
  };

  // Determine read mode based on file type
  if (file.name.endsWith(".noi") || file.name.endsWith(".json")) {
    reader.readAsText(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
}

/**
 * Handle ROM file
 */
async function handleRomFile(file, data) {
  romData = new Uint8Array(data);
  romStatus.textContent = `✓ ${file.name} (${(data.byteLength / 1024).toFixed(1)} KB)`;
}

/**
 * Handle NOI file
 */
async function handleNoiFile(file, data) {
  noiData = data;
  noiStatus.textContent = `✓ ${file.name}`;
}

/**
 * Handle input file
 */
async function handleInputFile(file, data) {
  try {
    inputData = JSON.parse(data);
    inputStatus.textContent = `✓ ${file.name} (${inputData.length} events)`;
  } catch (e) {
    inputStatus.textContent = `✗ Invalid JSON`;
    inputData = null;
  }
}

/**
 * Check if ready to run benchmark
 */
function checkReadyToRun() {
  runBtn.disabled = !(romData && noiData);
}

/**
 * Run the benchmark
 */
async function runBenchmark() {
  // Get config
  const startFrame = parseInt(startFrameInput.value, 10);
  const frames = parseInt(framesInput.value, 10);

  const totalFrames = startFrame + frames;

  // Show progress
  runBtn.disabled = true;
  progressSection.style.display = "block";
  progressFill.style.width = "0%";
  progressText.textContent = `Processing frame 0 / ${totalFrames}...`;

  // Capture canvas as data URL for in-memory storage
  const captures = [];

  try {
    const runner = new BenchmarkRunner({
      romData,
      noiData,
      inputData,
      createCanvas: (width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      startFrame,
      frames,
      captureMode: "all",
      verbose: false,
      disabledInterrupts: [],
      onProgress: (current, total) => {
        const percent = (current / total) * 100;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `Processing frame ${current} / ${total}...`;
      },
      onFrameComplete: async (frameIndex, canvas) => {
        // Always capture all frames in web mode
        const dataUrl = canvas.toDataURL("image/png");
        const capture = { src: dataUrl, frameIndex };
        captures.push(capture);
        return capture;
      },
    });

    const results = await runner.run();
    benchmarkResults = results;

    // Show results
    showResults(results);
  } catch (error) {
    console.error("Benchmark error:", error);
    alert(`Benchmark failed: ${error.message}`);
    progressSection.style.display = "none";
    runBtn.disabled = false;
  }
}

/**
 * Show results section
 */
function showResults(results) {
  uploadSection.style.display = "none";
  resultsSection.style.display = "flex";

  // Render the flamegraph viewer
  renderViewer(results.speedscope);
}

/**
 * Go back to upload section
 */
function backToUpload() {
  resultsSection.style.display = "none";
  uploadSection.style.display = "flex";
  progressSection.style.display = "none";
  runBtn.disabled = false;
}

/**
 * Initialize app
 */
function init() {
  // Setup drag and drop
  setupDragAndDrop("rom-drop-zone", "rom-file", handleRomFile);
  setupDragAndDrop("noi-drop-zone", "noi-file", handleNoiFile);
  setupDragAndDrop("input-drop-zone", "input-file", handleInputFile);

  // Setup buttons
  runBtn.addEventListener("click", runBenchmark);
  backBtn.addEventListener("click", backToUpload);

  // Check initial state
  checkReadyToRun();

  console.log("GB Flamegraph Web App initialized");
}

// Start the app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
