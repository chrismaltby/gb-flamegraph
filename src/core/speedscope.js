/**
 * Speedscope trace generation utilities
 * Generates traces compatible with https://www.speedscope.app
 */

/**
 * Create an empty speedscope trace structure
 * @param {Array<{symbol: string}>} noiLookup - Function symbols
 * @returns {object} Empty speedscope trace structure
 */
function createSpeedscopeTrace(noiLookup) {
  return {
    $schema: "https://www.speedscope.app/file-format-schema.json",
    shared: {
      frames: noiLookup.map((f) => ({ name: f.symbol })),
    },
    profiles: [
      {
        type: "evented",
        name: "GBVM Trace",
        unit: "frames",
        startValue: 0,
        endValue: 0,
        events: [],
      },
    ],
    captures: [],
  };
}

/**
 * Add an open event to the trace
 * @param {object} trace - Speedscope trace object
 * @param {number} frameIndex - Frame index in shared.frames
 * @param {number} at - Timestamp
 */
function addOpenEvent(trace, frameIndex, at) {
  trace.profiles[0].events.push({
    type: "O",
    at,
    frame: frameIndex,
  });
}

/**
 * Add a close event to the trace
 * @param {object} trace - Speedscope trace object
 * @param {number} frameIndex - Frame index in shared.frames
 * @param {number} at - Timestamp
 * @param {number} start - Start timestamp
 */
function addCloseEvent(trace, frameIndex, at, start) {
  trace.profiles[0].events.push({
    type: "C",
    at,
    frame: frameIndex,
    start,
  });
}

/**
 * Add a frame capture to the trace
 * @param {object} trace - Speedscope trace object
 * @param {string} src - Path or data URL to the capture
 * @param {number} at - Timestamp
 * @param {number} frameNumber - Actual frame number
 */
function addCapture(trace, src, at, frameNumber) {
  trace.captures.push({
    src,
    at,
    frameNumber,
  });
}

/**
 * Finalize the trace (sort events and set end value)
 * @param {object} trace - Speedscope trace object
 */
function finalizeTrace(trace, captureStartTime) {
  const events = trace.profiles[0].events;

  // Ensure a stable chronological order. If an open and close share the same
  // timestamp, the open must come first to keep the stack valid.
  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.type === b.type) return 0;
    return a.type === "O" ? -1 : 1;
  });

  // Filter speedscope events to exclude matching O/C pairs which end before start time.
  if (captureStartTime != null) {
    const include = new Array(events.length).fill(false);
    const stackByFrame = new Map();

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === "O") {
        const stack = stackByFrame.get(event.frame) ?? [];
        stack.push(i);
        stackByFrame.set(event.frame, stack);
      } else if (event.type === "C") {
        const stack = stackByFrame.get(event.frame);
        const openIndex = stack && stack.length > 0 ? stack.pop() : null;
        if (openIndex == null) {
          continue;
        }

        if (event.at >= captureStartTime) {
          include[openIndex] = true;
          include[i] = true;
        }
      } else {
        // Unknown event type - preserve it.
        include[i] = true;
      }
    }

    // Include any remaining opens that were never closed.
    for (const stack of stackByFrame.values()) {
      for (const openIndex of stack) {
        include[openIndex] = true;
      }
    }

    trace.profiles[0].events = events.filter((_, idx) => include[idx]);
  }

  const includedEvents = trace.profiles[0].events;
  if (includedEvents.length > 0) {
    trace.profiles[0].endValue = Math.max(...includedEvents.map((e) => e.at));
  }
}

/**
 * Get events between two timestamps
 * @param {Array} events - Array of speedscope events
 * @param {number} start - Start timestamp
 * @param {number} end - End timestamp
 * @returns {Array<{start: number, end: number, frame: number}>} Active events in range
 */
function getEventsBetween(events, start, end) {
  const stack = {};
  const activeEvents = [];

  // Match O/C pairs and track unclosed events
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

  // Any remaining opens in the stack are ongoing
  for (const [frame, times] of Object.entries(stack)) {
    for (const startTime of times) {
      activeEvents.push({
        start: startTime,
        end: Infinity,
        frame: parseInt(frame, 10),
      });
    }
  }

  // Filter to those overlapping the [start, end] range
  return activeEvents.filter((ev) => ev.end > start && ev.start < end);
}

module.exports = {
  createSpeedscopeTrace,
  addOpenEvent,
  addCloseEvent,
  addCapture,
  finalizeTrace,
  getEventsBetween,
};
