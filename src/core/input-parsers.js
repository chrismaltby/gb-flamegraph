/**
 * Input format parsers for various emulator recording formats
 */

/**
 * Parse JSON input format
 * @param {string|object} data - JSON string or parsed object
 * @returns {Array<{frame: number, press?: string[], release?: string[]}>}
 */
function parseJsonInput(data) {
  if (typeof data === "string") {
    return JSON.parse(data);
  }
  return data;
}

/**
 * Parse MESEN movie format (.msm)
 * @param {string} data - MESEN movie file content
 * @returns {Array<{frame: number, press?: string[], release?: string[]}>}
 * @todo Implement MESEN format parsing
 */
function parseMesenInput(data) {
  // Placeholder for future implementation
  throw new Error("MESEN format not yet implemented");
}

/**
 * Parse BGB recording format
 * @param {string} data - BGB recording file content
 * @returns {Array<{frame: number, press?: string[], release?: string[]}>}
 * @todo Implement BGB format parsing
 */
function parseBgbInput(data) {
  // Placeholder for future implementation
  throw new Error("BGB format not yet implemented");
}

/**
 * Auto-detect and parse input format
 * @param {string|object} data - Input data
 * @param {string} [format] - Explicit format: 'json', 'mesen', 'bgb'
 * @returns {Array<{frame: number, press?: string[], release?: string[]}>}
 */
function parseInput(data, format) {
  if (format) {
    switch (format.toLowerCase()) {
      case "json":
        return parseJsonInput(data);
      case "mesen":
        return parseMesenInput(data);
      case "bgb":
        return parseBgbInput(data);
      default:
        throw new Error(`Unknown input format: ${format}`);
    }
  }

  // Auto-detect format
  if (typeof data === "object") {
    // Already parsed JSON (object or array)
    return parseJsonInput(data);
  }

  if (typeof data === "string") {
    try {
      // Try JSON first
      return parseJsonInput(data);
    } catch (e) {
      // Could add auto-detection for other formats here
      throw new Error("Unable to auto-detect input format");
    }
  }

  throw new Error("Invalid input data");
}

module.exports = {
  parseJsonInput,
  parseMesenInput,
  parseBgbInput,
  parseInput,
};
