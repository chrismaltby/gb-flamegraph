/**
 * NOI (Name Object Information) file parser
 * Parses GBDK/GBVM memory map files to extract function symbols and addresses
 */

const INTERRUPTS = [
  {
    addr: 0x40,
    name: "VBL",
    symbol: "[INTERRUPT] VBL",
  },
  {
    addr: 0x48,
    name: "LCD",
    symbol: "[INTERRUPT] LCD",
  },
  {
    addr: 0x50,
    name: "TIM",
    symbol: "[INTERRUPT] TIM",
  },
  {
    addr: 0x58,
    name: "SIO",
    symbol: "[INTERRUPT] SIO",
  },
  {
    addr: 0x60,
    name: "JOY",
    symbol: "[INTERRUPT] JOY",
  },
];

/**
 * Parse a .noi file and extract function symbols with their addresses
 * @param {string} text - Content of the .noi file
 * @returns {Array<{symbol: string, addr: number, bank: number}>} Array of function symbols
 */
function parseNoi(text) {
  const lines = text.split("\n");
  const result = [];

  // Add interrupt handlers
  for (var i = 0; i < INTERRUPTS.length; i++) {
    const interrupt = INTERRUPTS[i];
    result.push({
      symbol: interrupt.symbol,
      addr: interrupt.addr,
      bank: 0,
    });
  }

  const usedAddr = {};

  for (const line of lines) {
    if (!/^DEF (_|F|\..*ISR|\.remove_|\.add_|\.mod|\.div)/.test(line)) continue;
    if (/_REG/.test(line)) continue;
    if (/_rRAM/.test(line)) continue;
    if (/_rROM/.test(line)) continue;
    if (/_rMBC/.test(line)) continue;
    if (/__start_save/.test(line)) continue;
    if (/___bank_/.test(line)) continue;
    if (/___func_/.test(line)) continue;
    if (/___mute_mask_/.test(line)) continue;

    const [, symbol, addrStr] = line.trim().split(/\s+/);
    const fullAddr = parseInt(addrStr, 16);

    const addr = fullAddr & 0xffff;
    const bank = addr < 0x4000 ? 0 : (fullAddr >> 16) & 0xff;

    const key = `b${bank}_${addr}`;

    const symbolClean = symbol.replace(/^F([^$]+)\$/, "").replace(/\$.*/, "");

    if (!usedAddr[key]) {
      result.push({
        symbol: symbolClean,
        addr,
        bank,
      });
      usedAddr[key] = true;
    }
  }

  return result;
}

/**
 * Generate function regions with start/end addresses from NOI lookup
 * @param {Array<{symbol: string, addr: number, bank: number}>} noiLookup - Parsed NOI data
 * @returns {Array<{symbol: string, addr: number, bank: number, end: number}>} Array of function regions
 */
function generateFunctionRegions(noiLookup) {
  const bankGroups = new Map();

  // Group symbols by bank
  for (const fn of noiLookup) {
    const bank = fn.bank;
    if (!bankGroups.has(bank)) {
      bankGroups.set(bank, []);
    }
    bankGroups.get(bank).push({ ...fn });
  }

  const regions = [];

  // For each bank, sort and assign end addresses
  for (const [bank, symbols] of bankGroups.entries()) {
    const addrMax = bank === 0 ? 0x3fff : 0x7fff;
    const sorted = symbols.sort((a, b) => a.addr - b.addr);
    for (let i = 0; i < sorted.length - 1; i++) {
      sorted[i].end = Math.min(addrMax, sorted[i + 1].addr - 1);
    }
    sorted[sorted.length - 1].end = addrMax; // until end of bank
    regions.push(...sorted);
  }

  return regions;
}

module.exports = {
  INTERRUPTS,
  parseNoi,
  generateFunctionRegions,
};
