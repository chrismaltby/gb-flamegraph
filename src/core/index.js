/**
 * Core benchmark module exports
 */

const BenchmarkRunner = require("./benchmark");
const { INTERRUPTS, parseNoi, generateFunctionRegions } = require("./noi-parser");
const { parseJsonInput, parseMesenInput, parseBgbInput, parseInput } = require("./input-parsers");
const {
  createSpeedscopeTrace,
  addOpenEvent,
  addCloseEvent,
  addCapture,
  finalizeTrace,
  getEventsBetween,
} = require("./speedscope");

module.exports = {
  BenchmarkRunner,
  INTERRUPTS,
  parseNoi,
  generateFunctionRegions,
  parseJsonInput,
  parseMesenInput,
  parseBgbInput,
  parseInput,
  createSpeedscopeTrace,
  addOpenEvent,
  addCloseEvent,
  addCapture,
  finalizeTrace,
  getEventsBetween,
};
