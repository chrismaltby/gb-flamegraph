/**
 * Flamegraph Viewer
 * Renders the interactive flamegraph and frame timeline
 */

const CYCLES_PER_FRAME = 70256;
const BAR_WIDTH = 10;

const toMCycles = (cycles) => cycles / 4;

let currentFrame = -1;
let showInterrupts = localStorage.getItem("showInterrupts") === "true";
let speedscopeData = null;

let viewerAbortController = null;

/**
 * Get events between two timestamps
 */
function eventsBetween(events, start, end) {
  const stack = {};
  const activeEvents = [];

  for (const event of events) {
    const { type, at, frame } = event;

    if (type === "O") {
      if (!stack[frame]) stack[frame] = [];
      stack[frame].push(at);
    } else if (type === "C") {
      if (stack[frame] && stack[frame].length > 0) {
        const startTime = stack[frame].pop();
        activeEvents.push({ start: startTime, end: at, frame });
      }
    }
  }

  for (const [frame, times] of Object.entries(stack)) {
    for (const startTime of times) {
      activeEvents.push({
        start: startTime,
        end: Infinity,
        frame: parseInt(frame, 10),
      });
    }
  }

  return activeEvents.filter((ev) => ev.end > start && ev.start < end);
}

/**
 * Generate color for function based on name
 */
function getFunctionColor(name) {
  if (name === "_vsync") {
    return "red";
  }
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  const saturation = 40;
  const lightness = 85;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Set the current frame and render flamegraph
 */
function setFrame(frameIndex) {
  if (frameIndex === currentFrame || !speedscopeData) {
    return;
  }

  const timelineEl = document.getElementById("timeline");
  const frameImgEl = document.getElementById("frame-img");
  const frameNumEl = document.getElementById("frame-num");
  const flamegraphEl = document.getElementById("flame-graph");

  const children = timelineEl.children;
  if (!children.length) return;

  const capture = speedscopeData.captures[frameIndex];
  if (!capture) return;

  currentFrame = frameIndex;
  const el = children[currentFrame];

  // Reset focus
  for (const child of children) {
    child.className = "";
  }

  if (el) {
    el.focus();
    el.className = "focus";
  }

  frameImgEl.src = capture.src;

  // Display the actual frame number (handles startFrame offset)
  frameNumEl.innerHTML =
    capture.frameNumber !== undefined ? capture.frameNumber : currentFrame;

  const frameStart = capture.at;
  const frameEnd = speedscopeData.captures[currentFrame + 1]?.at || Infinity;
  const events = eventsBetween(
    speedscopeData.profiles[0].events,
    frameStart,
    frameEnd,
  );

  flamegraphEl.innerHTML = "";
  events.sort((a, b) => a.start - b.start);

  let indent = 0;
  let previousEvent;
  let parentEventStack = [];
  let maxIndent = 0;
  let interruptUntil = 0;

  for (const event of events) {
    const eventFrame = speedscopeData.shared.frames[event.frame];

    if (!showInterrupts) {
      if (event.start < interruptUntil) {
        continue;
      }
      if (eventFrame.name.startsWith("[INTERRUPT]")) {
        interruptUntil = event.end;
        continue;
      }
    }

    const time =
      Math.min(event.end, frameEnd) - Math.max(event.start, frameStart);
    const timePercentage = 100 * (time / CYCLES_PER_FRAME);
    const cycles = event.end - event.start;
    const startTime = Math.max(event.start - frameStart, 0);
    const startPercentage = 100 * (startTime / CYCLES_PER_FRAME);

    if (previousEvent && event.start < previousEvent.end) {
      indent++;
      parentEventStack.push(previousEvent);
    } else {
      while (
        parentEventStack.length > 0 &&
        event.start >= parentEventStack[parentEventStack.length - 1].end
      ) {
        indent--;
        parentEventStack.pop();
      }
    }

    const childEvents = events.filter(
      (childEvent) =>
        childEvent.start >= event.start && childEvent.end <= event.end,
    );

    const interruptChildEvents = childEvents.filter((e) =>
      speedscopeData.shared.frames[e.frame].name.startsWith("[INTERRUPT]"),
    );

    const getMergedDuration = (events) => {
      if (events.length === 0) return 0;
      const sorted = [...events].sort((a, b) => a.start - b.start);
      const merged = [];

      for (const ev of sorted) {
        const clampedStart = Math.max(ev.start, event.start);
        const clampedEnd = Math.min(ev.end, event.end);

        if (merged.length === 0) {
          merged.push({ start: clampedStart, end: clampedEnd });
        } else {
          const last = merged[merged.length - 1];
          if (clampedStart <= last.end) {
            last.end = Math.max(last.end, clampedEnd);
          } else {
            merged.push({ start: clampedStart, end: clampedEnd });
          }
        }
      }

      return merged.reduce(
        (sum, interval) => sum + (interval.end - interval.start),
        0,
      );
    };

    const getDirectChildrenDuration = (events, parentEvent) => {
      const directChildren = events.filter((child) => {
        if (child === parentEvent) return false;
        if (child.start < parentEvent.start || child.end > parentEvent.end)
          return false;

        const hasIntermediateParent = events.some(
          (other) =>
            other !== parentEvent &&
            other !== child &&
            other.start <= child.start &&
            other.end >= child.end &&
            other.start > parentEvent.start,
        );

        return !hasIntermediateParent;
      });

      return getMergedDuration(directChildren);
    };

    const INTERRUPT_OVERHEAD_CYCLES = 20;
    const interruptedTime = getMergedDuration(interruptChildEvents);
    const uninterruptedTime =
      cycles -
      interruptedTime -
      interruptChildEvents.length * INTERRUPT_OVERHEAD_CYCLES;
    const directChildrenTime = getDirectChildrenDuration(childEvents, event);
    const selfTime = cycles - directChildrenTime;

    const frameMap = new Map();

    for (const e of childEvents) {
      const frame = speedscopeData.shared.frames[e.frame];
      const name = frame.name;
      const duration =
        Math.min(e.end, frameEnd) - Math.max(e.start, frameStart);

      if (!frameMap.has(name)) {
        frameMap.set(name, { name, duration: 0 });
      }

      frameMap.get(name).duration += duration;
    }

    const frameStats = [...frameMap.values()].sort(
      (a, b) => b.duration - a.duration,
    );

    let title = `${eventFrame.name}\n\n`;
    title += `Uninterrupted: ${toMCycles(uninterruptedTime)} M-Cycles\n`;
    title += `Total time : ${toMCycles(cycles)} M-Cycles\n`;
    title += `Self time: ${toMCycles(selfTime)} M-Cycles\n`;
    title += `\n`;

    const longestSymbolLength = Math.max(
      ...frameStats.map((event) => event.name.length),
    );

    for (const { name, duration } of frameStats) {
      const clampedDuration = Math.min(duration, time);
      const filledLength = Math.round((clampedDuration / time) * BAR_WIDTH);
      const bar = `|${"#".repeat(filledLength)}${"-".repeat(
        BAR_WIDTH - filledLength,
      )}|`;
      const paddedName = name.padEnd(longestSymbolLength);
      const durStr = String(toMCycles(duration)).padStart(8);
      title += ` * ${paddedName} ${durStr} ${bar} \n`;
    }

    const eventEl = document.createElement("div");
    eventEl.innerHTML = `<div><strong>${eventFrame.name}</strong><br />${toMCycles(eventFrame.name === "_vsync" ? cycles : uninterruptedTime)}</div>`;
    eventEl.dataset.title = title;
    eventEl.style.width = `${timePercentage}%`;
    eventEl.style.minWidth = `${timePercentage}%`;
    eventEl.style.left = `${startPercentage}%`;
    eventEl.style.top = `${indent * 30}px`;
    eventEl.style.background = getFunctionColor(eventFrame.name);

    if (indent > maxIndent) {
      maxIndent = indent;
    }

    flamegraphEl.appendChild(eventEl);
    previousEvent = event;
  }

  flamegraphEl.style.height = `${(maxIndent + 10) * 30}px`;
  window.location.hash = currentFrame;
}

/**
 * Refresh current frame (e.g., when toggling interrupts)
 */
function refreshFrame() {
  const frame = currentFrame;
  currentFrame = -1;
  setFrame(frame);
}

/**
 * Render the viewer with speedscope data
 */
export function renderViewer(data) {
  // Clean up previous listeners
  if (viewerAbortController) {
    viewerAbortController.abort();
  }
  viewerAbortController = new AbortController();
  const { signal } = viewerAbortController;

  speedscopeData = data;

  const timelineEl = document.getElementById("timeline");
  const flamegraphSizeEl = document.getElementById("flame-graph-size");
  const toggleInterruptsEl = document.getElementById("toggle-interrupts");

  // Clear timeline
  timelineEl.innerHTML = "";

  // Create timeline buttons
  let i = 0;
  for (const capture of data.captures) {
    const captureEl = document.createElement("button");
    captureEl.style.background = `url(${capture.src})`;
    captureEl.style.backgroundSize = `cover`;
    captureEl.style.backgroundPosition = `center`;
    captureEl.style.width = `${160 / 2}px`;
    captureEl.style.height = `${144 / 2}px`;
    timelineEl.appendChild(captureEl);

    captureEl.addEventListener(
      "click",
      ((index) => () => {
        setFrame(index);
      })(i),
    );

    i++;
  }

  // Setup keyboard navigation
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowLeft") {
        setFrame(Math.max(0, currentFrame - 1));
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        setFrame(Math.min(data.captures.length - 1, currentFrame + 1));
        event.preventDefault();
      }
    },
    { signal },
  );

  // Setup flamegraph size slider
  flamegraphSizeEl.addEventListener(
    "input",
    (event) => {
      const value = parseInt(event.currentTarget.value, 10);
      document.getElementById("flame-graph").style.width =
        `${100 + 19 * value}%`;
    },
    { signal },
  );

  // Setup interrupt toggle
  toggleInterruptsEl.checked = showInterrupts;
  toggleInterruptsEl.addEventListener(
    "change",
    (event) => {
      showInterrupts = event.currentTarget.checked;
      localStorage.setItem("showInterrupts", showInterrupts ? "true" : "false");
      refreshFrame();
    },
    { signal },
  );

  // Jump to hash or last frame
  const jumpToHashFrame = () => {
    const hashFrame = parseInt(window.location.hash.substring(1), 10);
    if (hashFrame && !isNaN(hashFrame)) {
      setFrame(hashFrame);
      return true;
    }
    return false;
  };

  window.addEventListener("hashchange", jumpToHashFrame, { signal });

  if (!jumpToHashFrame()) {
    setFrame(data.captures.length - 1);
  }
}
