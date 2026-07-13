(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AeaInterval = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = "aea-electricity-engine-2.4.0";
  const BINS = 48;
  const DAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

  function emptyGrid() {
    return Array.from({ length: 7 }, function () { return new Array(BINS).fill(0); });
  }

  function cloneGrid(grid) {
    return (grid || emptyGrid()).map(function (row) { return row.slice(); });
  }

  function gridSum(grid) {
    let total = 0;
    for (let d = 0; d < 7; d++) for (let b = 0; b < BINS; b++) total += Number(grid[d][b]) || 0;
    return total;
  }

  function scaleGrid(grid, target) {
    const total = gridSum(grid);
    const factor = total > 0 ? target / total : 0;
    return grid.map(function (row) { return row.map(function (v) { return v * factor; }); });
  }

  function blockCostDetails(rates, usageKwh, days, ratePeriod) {
    if (!Array.isArray(rates) || !rates.length) return { total: 0, tiers: [] };
    let remaining = Math.max(0, Number(usageKwh) || 0), cost = 0, consumed = 0;
    const tiers = [];
    for (let i = 0; i < rates.length && remaining > 0; i++) {
      const rate = rates[i] || {};
      const price = Math.max(0, Number(rate.unitPrice) || 0);
      let volume = rate.volume == null ? Infinity : Math.max(0, Number(rate.volume) || 0);
      if (rate.volume != null && ratePeriod === "P1D") volume *= days;
      else if (rate.volume != null && ratePeriod === "P1M") volume *= days * 12 / 365;
      if (i === rates.length - 1) volume = Infinity;
      const used = Math.min(remaining, volume);
      const tierCost = used * price;
      cost += tierCost;
      tiers.push({ tier: i + 1, fromKwh: consumed, toKwh: consumed + used, quantityKwh: used, unitPrice: price, cost: tierCost });
      consumed += used;
      remaining -= used;
    }
    return { total: cost, tiers: tiers };
  }

  function blockCost(rates, usageKwh, days, ratePeriod) {
    const result = blockCostDetails(rates, usageKwh, days, ratePeriod);
    return result.total;
  }

  function controlledLoadCost(controlledLoads, annualKwh, profile) {
    if (!(annualKwh > 0)) return { supported: true, total: 0, usage: 0, supply: 0, rateList: [], details: [] };
    if (!Array.isArray(controlledLoads) || controlledLoads.length !== 1) return { supported: false, reason: "A single published controlled-load tariff is required." };
    const block = controlledLoads[0];
    let usage = 0;
    const supply = Math.max(0, Number(block.dailyCharge) || 0) * 365;
    const rateList = [], details = [];
    if (supply > 0) details.push({ kind: "controlled-supply", label: block.displayName || "Controlled-load daily charge", quantity: 365, unit: "days", unitPrice: Math.max(0, Number(block.dailyCharge) || 0), cost: supply });
    if (block.rateBlockUType === "singleRate" && block.singleRate) {
      const priced = blockCostDetails(block.singleRate.rates, annualKwh, 365, block.singleRate.period);
      usage = priced.total;
      priced.tiers.forEach(function (tier) { details.push(Object.assign({ kind: "controlled-usage", label: block.displayName || "Controlled load" }, tier)); });
      const first = block.singleRate.rates && block.singleRate.rates[0];
      if (first) rateList.push({ label: block.displayName || "controlled load", unitPrice: Number(first.unitPrice) || 0 });
    } else if (block.rateBlockUType === "timeOfUseRates" && Array.isArray(block.timeOfUseRates) && block.timeOfUseRates.length) {
      const fractions = block.timeOfUseRates.map(function (rate) { return profileFraction(profile, rate.timeOfUse); });
      const totalFraction = fractions.reduce(function (sum, value) { return sum + value; }, 0);
      block.timeOfUseRates.forEach(function (rate, index) {
        const fraction = totalFraction > 0 ? fractions[index] / totalFraction : 1 / block.timeOfUseRates.length;
        const priced = blockCostDetails(rate.rates, annualKwh * fraction, 365, rate.period);
        usage += priced.total;
        priced.tiers.forEach(function (tier) { details.push(Object.assign({ kind: "controlled-usage", label: (rate.type || block.displayName || "controlled load").toLowerCase().replace(/_/g, " "), fraction: fraction }, tier)); });
        const first = rate.rates && rate.rates[0];
        if (first) rateList.push({ label: (rate.type || block.displayName || "controlled load").toLowerCase().replace(/_/g, " "), unitPrice: Number(first.unitPrice) || 0 });
      });
    } else {
      return { supported: false, reason: "The published controlled-load tariff shape is unsupported." };
    }
    return { supported: true, total: usage + supply, usage: usage, supply: supply, rateList: rateList, details: details };
  }

  function demandDays(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const days = [];
    if (value.weekdays) days.push("MON", "TUE", "WED", "THU", "FRI");
    if (value.saturday) days.push("SAT");
    if (value.sunday) days.push("SUN");
    return days;
  }

  function tierDemand(value, charge) {
    const minimum = Math.max(0, Number(charge.minDemand) || 0);
    const maximum = charge.maxDemand == null ? Infinity : Math.max(minimum, Number(charge.maxDemand) || minimum);
    return Math.max(0, Math.min(value, maximum) - minimum);
  }

  function demandChargeCost(tariffPeriods, series) {
    const demandPeriods = (tariffPeriods || []).filter(function (period) { return period.rateBlockUType === "demandCharges"; });
    if (!demandPeriods.length) return { supported: true, total: 0, peakKw: 0, chargeCount: 0 };
    if (!Array.isArray(series) || !series.length) return { supported: false, reason: "Interval series is required for demand pricing." };
    let total = 0, peakKw = 0, chargeCount = 0;
    const details = [];
    for (const period of demandPeriods) {
      const periodSeries = series.filter(function (day) { return dateInPeriod(day.date, period); });
      for (const charge of period.demandCharges || []) {
        const measurement = String(charge.measurementPeriod || "").toUpperCase();
        const charging = String(charge.chargePeriod || "").toUpperCase();
        if (!((measurement === "DAY" && charging === "DAY") || (measurement === "MONTH" && (charging === "DAY" || charging === "MONTH")))) {
          return { supported: false, reason: "Unsupported demand measurement and charge period combination." };
        }
        const amount = Number(charge.amount);
        if (!Number.isFinite(amount) || amount < 0) return { supported: false, reason: "Invalid demand charge amount." };
        const window = { days: demandDays(charge.days), startTime: charge.startTime, endTime: charge.endTime };
        const daily = periodSeries.map(function (day) {
          const values = day.general || day.import || day.values || [];
          let maximum = 0, matched = false;
          for (let bin = 0; bin < BINS; bin++) if (windowMatches(day.dow, bin, [window])) {
            matched = true;
            maximum = Math.max(maximum, (Number(values[bin]) || 0) * 2);
          }
          return { date: day.date, demand: maximum, matched: matched };
        });
        let chargeTotal = 0, billedKwUnits = 0, periodCount = 0, chargePeak = 0;
        if (measurement === "DAY") {
          daily.filter(function (day) { return day.matched; }).forEach(function (day) {
            peakKw = Math.max(peakKw, day.demand);
            chargePeak = Math.max(chargePeak, day.demand);
            const quantity = tierDemand(day.demand, charge);
            billedKwUnits += quantity;
            chargeTotal += quantity * amount;
            periodCount++;
          });
        } else {
          const months = new Map();
          daily.forEach(function (day) {
            const key = day.date.slice(0, 6);
            if (!months.has(key)) months.set(key, { maximum: 0, days: 0 });
            const month = months.get(key);
            month.days++;
            if (day.matched) month.maximum = Math.max(month.maximum, day.demand);
          });
          months.forEach(function (month) {
            peakKw = Math.max(peakKw, month.maximum);
            chargePeak = Math.max(chargePeak, month.maximum);
            const quantity = tierDemand(month.maximum, charge) * (charging === "DAY" ? month.days : 1);
            billedKwUnits += quantity;
            chargeTotal += quantity * amount;
            periodCount++;
          });
        }
        total += chargeTotal;
        details.push({
          label: charge.displayName || "Demand charge", measurementPeriod: measurement, chargePeriod: charging,
          startTime: charge.startTime, endTime: charge.endTime, days: demandDays(charge.days),
          unitPrice: amount, peakKw: chargePeak, billedKwUnits: billedKwUnits, periodCount: periodCount, total: chargeTotal
        });
        chargeCount++;
      }
    }
    return { supported: true, total: total, peakKw: peakKw, chargeCount: chargeCount, details: details };
  }

  function parseLocalDate(dateStr) {
    if (!/^\d{8}$/.test(String(dateStr || ""))) return null;
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6), d = +dateStr.slice(6, 8);
    const stamp = Date.UTC(y, m - 1, d);
    const check = new Date(stamp);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return { y: y, m: m, d: d, stamp: stamp, dow: (check.getUTCDay() + 6) % 7 };
  }

  function parseTime(value, fallback) {
    if (value == null || value === "") return fallback;
    const match = String(value).trim().match(/^(\d{1,2})(?::?)(\d{2})?/);
    if (!match) return fallback;
    const h = +match[1], m = +(match[2] || 0);
    if (h > 24 || m > 59 || (h === 24 && m !== 0)) return fallback;
    return h + m / 60;
  }

  function daysToSet(days) {
    const set = new Set();
    (days || []).forEach(function (raw) {
      const day = String(raw || "").toUpperCase();
      if (day === "BUSINESS_DAYS" || day === "WEEKDAYS") [0, 1, 2, 3, 4].forEach(function (d) { set.add(d); });
      else if (day in DAY_INDEX) set.add(DAY_INDEX[day]);
      else if (day.slice(0, 3) in DAY_INDEX) set.add(DAY_INDEX[day.slice(0, 3)]);
    });
    if (!set.size) for (let d = 0; d < 7; d++) set.add(d);
    return set;
  }

  function windowMatches(dow, bin, windows) {
    if (!Array.isArray(windows) || !windows.length) return true;
    const hour = bin / 2 + 0.25;
    return windows.some(function (window) {
      if (!daysToSet(window.days).has(dow)) return false;
      const start = parseTime(window.startTime, 0);
      let end = parseTime(window.endTime, 24);
      if (end === 0) end = 24;
      return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    });
  }

  function dateInPeriod(dateStr, period) {
    if (!period || !period.startDate || !period.endDate) return true;
    const md = +(dateStr.slice(4, 8));
    const start = +String(period.startDate).replace("-", "");
    const end = +String(period.endDate).replace("-", "");
    if (!start || !end) return true;
    return start <= end ? md >= start && md <= end : md >= start || md <= end;
  }

  function profileFraction(profile, windows) {
    let matched = 0, total = 0;
    for (let d = 0; d < 7; d++) for (let b = 0; b < BINS; b++) {
      const value = Number(profile[d][b]) || 0;
      total += value;
      if (windowMatches(d, b, windows)) matched += value;
    }
    return total > 0 ? matched / total : 0;
  }

  function meterFraction(meter, period, windows, direction) {
    if (!meter || !Array.isArray(meter.series)) return null;
    const field = direction === "export" ? "export" : "import";
    let rows = meter.series.filter(function (day) { return dateInPeriod(day.date, period); });
    if (rows.length < 7) rows = meter.series;
    let matched = 0, total = 0;
    rows.forEach(function (day) {
      const values = day[field] || [];
      for (let b = 0; b < BINS; b++) {
        const value = Number(values[b]) || 0;
        total += value;
        if (windowMatches(day.dow, b, windows)) matched += value;
      }
    });
    return total > 0 ? matched / total : null;
  }

  function meterPeriodShare(meter, period, direction) {
    if (!meter || !meter.fullYear || !Array.isArray(meter.series)) return null;
    const field = direction === "export" ? "export" : "import";
    let inPeriod = 0, total = 0;
    meter.series.forEach(function (day) {
      const sum = (day[field] || []).reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
      total += sum;
      if (dateInPeriod(day.date, period)) inPeriod += sum;
    });
    return total > 0 ? inPeriod / total : null;
  }

  function filterPlansByDistributor(plans, distributor) {
    if (!Array.isArray(plans)) return [];
    if (!distributor) return plans.slice();
    return plans.filter(function (plan) {
      return Array.isArray(plan.distributors) && plan.distributors.includes(distributor);
    });
  }

  function suggestedRegisterRole(registerId, suffix) {
    const value = (String(registerId || "") + " " + String(suffix || "")).toUpperCase();
    if (/CONTROL|CTRL|OFF[ _-]?PEAK|HOT[ _-]?WATER|\bCL\d*\b/.test(value)) return { role: "controlled", confidence: "explicit" };
    if (/^E1(?:\s|$)/.test(value) || /\sE1$/.test(value)) return { role: "general", confidence: "likely" };
    return { role: null, confidence: "review" };
  }

  function allocateRegisters(registers, roles) {
    const selected = (registers || []).filter(function (register) { return register.direction === "import"; });
    const unresolved = selected.filter(function (register) { return !["general", "controlled"].includes(roles && roles[register.id]); });
    if (unresolved.length) return { ok: false, unresolved: unresolved.map(function (register) { return register.id; }) };
    const dates = new Map();
    let generalObserved = 0, controlledObserved = 0;
    selected.forEach(function (register) {
      const role = roles[register.id];
      if (role === "general") generalObserved += register.observedKwh;
      else controlledObserved += register.observedKwh;
      register.series.forEach(function (day) {
        if (!dates.has(day.date)) dates.set(day.date, { date: day.date, dow: day.dow, stamp: day.stamp, general: new Array(BINS).fill(0), controlled: new Array(BINS).fill(0) });
        const target = dates.get(day.date)[role];
        for (let bin = 0; bin < BINS; bin++) target[bin] += Number(day.values[bin]) || 0;
      });
    });
    const series = Array.from(dates.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
    const generalGrid = emptyGrid(), controlledGrid = emptyGrid(), dayCounts = new Array(7).fill(0);
    series.forEach(function (day) {
      dayCounts[day.dow]++;
      for (let bin = 0; bin < BINS; bin++) {
        generalGrid[day.dow][bin] += day.general[bin];
        controlledGrid[day.dow][bin] += day.controlled[bin];
      }
    });
    const observedDays = series.length || 1;
    return {
      ok: true,
      series: series,
      generalObservedKwh: generalObserved,
      controlledObservedKwh: controlledObserved,
      annualGeneralKwh: generalObserved / observedDays * 365,
      annualControlledKwh: controlledObserved / observedDays * 365,
      generalProfile: averageWeeklyProfile(generalGrid, dayCounts),
      controlledProfile: averageWeeklyProfile(controlledGrid, dayCounts),
      controlledRegisterIds: selected.filter(function (register) { return roles[register.id] === "controlled"; }).map(function (register) { return register.id; })
    };
  }

  function parseNem12(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(function (line) { return line.trim() !== ""; });
    let channel = null, lastRecord = null, found100 = false, found200 = false, found300 = false, found900 = false;
    let outOfOrder = false, duplicateRecords = 0;
    const previousDateByChannel = new Map();
    const nmis = new Set(), importChannels = new Set(), exportChannels = new Set();
    const records = new Map();

    lines.forEach(function (raw) {
      const fields = raw.split(",");
      const type = String(fields[0] || "").trim();
      if (type === "100") {
        found100 = String(fields[1] || "").trim().toUpperCase() === "NEM12";
      } else if (type === "200") {
        lastRecord = null;
        found200 = true;
        const nmi = String(fields[1] || "").trim();
        const registerId = String(fields[3] || "").trim();
        const suffix = String(fields[4] || "").trim().toUpperCase();
        const meter = String(fields[6] || "").trim();
        const unit = String(fields[7] || "").trim().toUpperCase();
        const interval = parseInt(fields[8], 10);
        if (nmi) nmis.add(nmi);
        const activeEnergy = unit === "WH" || unit === "KWH" || unit === "MWH";
        const direction = activeEnergy && suffix.charAt(0) === "E" ? "import" :
          (activeEnergy && suffix.charAt(0) === "B" ? "export" : null);
        channel = {
          nmi: nmi, registerId: registerId, suffix: suffix, meter: meter,
          direction: direction,
          scale: unit === "WH" ? 0.001 : (unit === "MWH" ? 1000 : 1),
          interval: [5, 15, 30].includes(interval) ? interval : null
        };
        if (direction === "import") importChannels.add(suffix);
        if (direction === "export") exportChannels.add(suffix);
      } else if (type === "300" && channel && channel.direction && channel.interval) {
        found300 = true;
        const date = String(fields[1] || "").trim();
        const parsedDate = parseLocalDate(date);
        const count = 1440 / channel.interval;
        if (!parsedDate || fields.length < 2 + count) return;
        const orderKey = [channel.nmi, channel.suffix, channel.registerId, channel.meter].join("|");
        const previousDate = previousDateByChannel.get(orderKey);
        if (previousDate && date < previousDate) outOfOrder = true;
        previousDateByChannel.set(orderKey, date);
        const values = new Array(count), quality = new Array(count);
        const qualityMethod = String(fields[2 + count] || "").trim().toUpperCase() || "U";
        for (let i = 0; i < count; i++) {
          const value = Number(fields[2 + i]);
          values[i] = Number.isFinite(value) && value >= 0 ? value * channel.scale : 0;
          quality[i] = qualityMethod.charAt(0) || "U";
        }
        const record = { channel: Object.assign({}, channel), date: date, parsedDate: parsedDate, values: values, quality: quality };
        const key = [channel.nmi, channel.suffix, channel.registerId, channel.meter, date].join("|");
        if (records.has(key)) duplicateRecords++;
        records.set(key, record);
        lastRecord = record;
      } else if (type === "400" && lastRecord) {
        const start = Math.max(1, parseInt(fields[1], 10) || 1);
        const end = Math.min(lastRecord.quality.length, parseInt(fields[2], 10) || lastRecord.quality.length);
        const flag = String(fields[3] || "U").trim().toUpperCase().charAt(0) || "U";
        for (let i = start - 1; i < end; i++) lastRecord.quality[i] = flag;
      } else if (type === "900") found900 = true;
    });

    if (!found100 || !found200 || !found300 || !found900) {
      return { ok: false, err: "This is not a complete NEM12 file. It must contain valid 100, 200, 300 and 900 records." };
    }
    if (nmis.size > 1) return { ok: false, err: "This file contains more than one NMI. Please export one connection point at a time so separate households are not combined." };
    if (!importChannels.size) return { ok: false, err: "No active-energy usage channel was found. Please download detailed NEM12 consumption data for this NMI." };

    const byDate = new Map();
    const registerDates = new Map();
    const qualityCounts = {}, intervalLengths = new Set();
    records.forEach(function (record) {
      const dir = record.channel.direction;
      intervalLengths.add(record.channel.interval);
      if (!byDate.has(record.date)) {
        byDate.set(record.date, { date: record.date, dow: record.parsedDate.dow, stamp: record.parsedDate.stamp, import: new Array(BINS).fill(0), export: new Array(BINS).fill(0), importSeen: false, exportSeen: false });
      }
      const day = byDate.get(record.date);
      day[dir + "Seen"] = true;
      for (let i = 0; i < record.values.length; i++) {
        const bin = Math.min(BINS - 1, Math.floor(i * record.channel.interval / 30));
        day[dir][bin] += record.values[i];
        if (dir === "import") {
          const flag = record.quality[i] || "U";
          qualityCounts[flag] = (qualityCounts[flag] || 0) + 1;
        }
      }
      if (dir === "import") {
        const registerKey = [record.channel.suffix, record.channel.registerId, record.channel.meter].join("|");
        if (!registerDates.has(registerKey)) registerDates.set(registerKey, { channel: record.channel, days: new Map() });
        const bucket = registerDates.get(registerKey);
        if (!bucket.days.has(record.date)) bucket.days.set(record.date, { date: record.date, dow: record.parsedDate.dow, stamp: record.parsedDate.stamp, values: new Array(BINS).fill(0) });
        const registerDay = bucket.days.get(record.date);
        for (let i = 0; i < record.values.length; i++) {
          const bin = Math.min(BINS - 1, Math.floor(i * record.channel.interval / 30));
          registerDay.values[bin] += record.values[i];
        }
      }
    });

    const series = Array.from(byDate.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
    const importDays = series.filter(function (day) { return day.importSeen; });
    const exportDays = series.filter(function (day) { return day.exportSeen; });
    if (importDays.length < 7) return { ok: false, err: "The file covers less than a week of usage (" + importDays.length + " days). Please download at least a few weeks, ideally 12 months." };

    const grid = emptyGrid(), exportGrid = emptyGrid(), dowCount = new Array(7).fill(0), exportDowCount = new Array(7).fill(0);
    let importKwh = 0, exportKwh = 0;
    importDays.forEach(function (day) {
      dowCount[day.dow]++;
      for (let b = 0; b < BINS; b++) { grid[day.dow][b] += day.import[b]; importKwh += day.import[b]; }
    });
    exportDays.forEach(function (day) {
      exportDowCount[day.dow]++;
      for (let b = 0; b < BINS; b++) { exportGrid[day.dow][b] += day.export[b]; exportKwh += day.export[b]; }
    });

    const first = importDays[0], last = importDays[importDays.length - 1];
    const spanDays = Math.round((last.stamp - first.stamp) / 86400000) + 1;
    const coverageRatio = spanDays > 0 ? importDays.length / spanDays : 0;
    const qualityTotal = Object.keys(qualityCounts).reduce(function (sum, key) { return sum + qualityCounts[key]; }, 0);
    const actualPct = qualityTotal ? (qualityCounts.A || 0) / qualityTotal : 0;
    const fullYear = importDays.length >= 330 && spanDays >= 330 && coverageRatio >= 0.9;
    const annualImport = importKwh / importDays.length * 365;
    const annualExport = exportDays.length ? exportKwh / exportDays.length * 365 : 0;
    const registers = Array.from(registerDates.values()).map(function (bucket) {
      const registerSeries = Array.from(bucket.days.values()).sort(function (a, b) { return a.date.localeCompare(b.date); });
      const observedKwh = registerSeries.reduce(function (total, day) { return total + day.values.reduce(function (sum, value) { return sum + value; }, 0); }, 0);
      const suggestion = suggestedRegisterRole(bucket.channel.registerId, bucket.channel.suffix);
      return {
        registerId: bucket.channel.registerId,
        suffix: bucket.channel.suffix,
        direction: bucket.channel.direction,
        intervalMinutes: bucket.channel.interval,
        observedKwh: observedKwh,
        annualKwh: registerSeries.length ? observedKwh / registerSeries.length * 365 : 0,
        observedDays: registerSeries.length,
        suggestedRole: suggestion.role,
        roleConfidence: suggestion.confidence,
        series: registerSeries
      };
    }).sort(function (a, b) { return (a.suffix + "|" + a.registerId).localeCompare(b.suffix + "|" + b.registerId); });
    registers.forEach(function (register, index) { register.id = "import-" + (index + 1); });

    let confidence = "low";
    if (fullYear && actualPct >= 0.9) confidence = "high";
    else if (importDays.length >= 180 && coverageRatio >= 0.85) confidence = "good";
    else if (importDays.length >= 28) confidence = "indicative";
    const warnings = [];
    if (!fullYear) warnings.push("Annual usage is extrapolated from " + importDays.length + " days and may not capture seasonal heating, cooling or holiday behaviour.");
    if (coverageRatio < 0.9) warnings.push("Only " + Math.round(coverageRatio * 100) + "% of calendar days in the file span contain usage records.");
    if (actualPct < 0.9) warnings.push(Math.round(actualPct * 100) + "% of usage intervals are marked actual; the remainder include estimated, substituted or unknown quality data.");
    if (outOfOrder) warnings.push("Daily records were out of order. They were sorted before analysis.");
    if (duplicateRecords) warnings.push(duplicateRecords + " duplicate channel-day record" + (duplicateRecords === 1 ? " was" : "s were") + " replaced by the latest record.");
    if (importChannels.size > 1) warnings.push("Multiple consumption registers were preserved separately. Confirm which register is general usage and which is controlled load before comparing plans.");

    return {
      ok: true,
      nmi: Array.from(nmis)[0] || null,
      importKwh: importKwh,
      exportKwh: exportKwh,
      annualImport: annualImport,
      annualExport: annualExport,
      spanDays: importDays.length,
      dateSpanDays: spanDays,
      coverageRatio: coverageRatio,
      startDate: first.date,
      endDate: last.date,
      fullYear: fullYear,
      confidence: confidence,
      actualPct: actualPct,
      warnings: warnings,
      profile: grid,
      grid: grid,
      exportProfile: exportGrid,
      exportGrid: exportGrid,
      dowCount: dowCount,
      exportDowCount: exportDowCount,
      series: series,
      eChannels: importChannels,
      bChannels: exportChannels,
      intervalLengths: Array.from(intervalLengths).sort(function (a, b) { return a - b; }),
      qualityCounts: qualityCounts,
      registers: registers
    };
  }

  function averageWeeklyProfile(grid, dayCounts) {
    const out = emptyGrid();
    for (let d = 0; d < 7; d++) {
      const count = Number(dayCounts && dayCounts[d]) || 0;
      for (let b = 0; b < BINS; b++) out[d][b] = count > 0 ? grid[d][b] / count : 0;
    }
    return out;
  }

  function solarShape() {
    const shape = [], sunrise = 6.5, sunset = 19;
    let total = 0;
    for (let b = 0; b < BINS; b++) {
      const hour = b / 2 + 0.25;
      const value = hour >= sunrise && hour <= sunset ? Math.max(0, Math.sin(Math.PI * (hour - sunrise) / (sunset - sunrise))) : 0;
      shape.push(value); total += value;
    }
    return shape.map(function (value) { return value / total; });
  }

  function simulateSolar(loadProfile, annualLoadKwh, annualGenerationKwh) {
    const weeklyLoad = scaleGrid(loadProfile, annualLoadKwh * 7 / 365);
    const shape = solarShape(), dailyGeneration = annualGenerationKwh / 365;
    const imports = emptyGrid(), exports = emptyGrid();
    let selfUseWeekly = 0;
    for (let d = 0; d < 7; d++) for (let b = 0; b < BINS; b++) {
      const generation = dailyGeneration * shape[b];
      const used = Math.min(weeklyLoad[d][b], generation);
      selfUseWeekly += used;
      imports[d][b] = Math.max(0, weeklyLoad[d][b] - generation);
      exports[d][b] = Math.max(0, generation - weeklyLoad[d][b]);
    }
    return {
      importProfile: imports,
      exportProfile: exports,
      annualImport: gridSum(imports) * 365 / 7,
      annualExport: gridSum(exports) * 365 / 7,
      annualSelfUse: selfUseWeekly * 365 / 7,
      selfUsePct: annualGenerationKwh > 0 ? selfUseWeekly * 365 / 7 / annualGenerationKwh : 0
    };
  }

  function simulateBattery(importProfile, exportProfile, annualImportKwh, annualExportKwh, sizeKwh, roundTripEfficiency) {
    const imports = scaleGrid(importProfile, annualImportKwh * 7 / 365);
    const exports = scaleGrid(exportProfile, annualExportKwh * 7 / 365);
    const efficiency = Math.sqrt(roundTripEfficiency || 0.9);
    const capacity = Math.max(0, Number(sizeKwh) || 0);
    let state = 0, capturedImport = null, capturedExport = null, capturedDischarge = 0, capturedCharge = 0;
    for (let pass = 0; pass < 8; pass++) {
      const outImport = emptyGrid(), outExport = emptyGrid();
      let discharge = 0, charge = 0;
      for (let d = 0; d < 7; d++) for (let b = 0; b < BINS; b++) {
        let imp = imports[d][b], exp = exports[d][b];
        const chargeInput = Math.min(exp, Math.max(0, capacity - state) / efficiency);
        state += chargeInput * efficiency; exp -= chargeInput; charge += chargeInput;
        const dischargeOutput = Math.min(imp, state * efficiency);
        state -= dischargeOutput / efficiency; imp -= dischargeOutput; discharge += dischargeOutput;
        outImport[d][b] = imp; outExport[d][b] = exp;
      }
      if (pass === 7) { capturedImport = outImport; capturedExport = outExport; capturedDischarge = discharge; capturedCharge = charge; }
    }
    return {
      importProfile: capturedImport,
      exportProfile: capturedExport,
      annualImport: gridSum(capturedImport) * 365 / 7,
      annualExport: gridSum(capturedExport) * 365 / 7,
      annualDischarge: capturedDischarge * 365 / 7,
      annualCharge: capturedCharge * 365 / 7,
      dailyDischarge: capturedDischarge / 7
    };
  }

  return {
    ENGINE_VERSION: ENGINE_VERSION,
    emptyGrid: emptyGrid,
    cloneGrid: cloneGrid,
    gridSum: gridSum,
    scaleGrid: scaleGrid,
    blockCost: blockCost,
    blockCostDetails: blockCostDetails,
    controlledLoadCost: controlledLoadCost,
    demandChargeCost: demandChargeCost,
    parseTime: parseTime,
    daysToSet: daysToSet,
    windowMatches: windowMatches,
    dateInPeriod: dateInPeriod,
    profileFraction: profileFraction,
    meterFraction: meterFraction,
    meterPeriodShare: meterPeriodShare,
    filterPlansByDistributor: filterPlansByDistributor,
    suggestedRegisterRole: suggestedRegisterRole,
    allocateRegisters: allocateRegisters,
    parseNem12: parseNem12,
    averageWeeklyProfile: averageWeeklyProfile,
    simulateSolar: simulateSolar,
    simulateBattery: simulateBattery
  };
});
