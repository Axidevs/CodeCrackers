/**
 * CURA Caregiver Dataset In-Memory Loader
 * Reads and indexes the synthetic caregivers profiles on startup.
 */

const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { parseCaregiverCsv } = require("../utils/caregiverCsv");

class CaregiverDataService {
  constructor(dataPath = env.DATASET_PATH) {
    this.dataPath = dataPath;
    this.caregivers = [];
    this.caregiverMap = new Map();
    this.loadData();
  }

  loadData() {
    if (!fs.existsSync(this.dataPath)) {
      throw new Error(`Caregivers dataset file not found at ${this.dataPath}`);
    }

    const raw = fs.readFileSync(this.dataPath, "utf-8");
    const loaded = path.extname(this.dataPath).toLowerCase() === ".csv"
      ? parseCaregiverCsv(raw)
      : JSON.parse(raw);
    if (!Array.isArray(loaded)) throw new Error(`Caregivers dataset at ${this.dataPath} must contain an array`);

    const ids = new Set();
    for (const caregiver of loaded) {
      if (!caregiver || typeof caregiver.caregiver_id !== "string" || !caregiver.caregiver_id || ids.has(caregiver.caregiver_id)) {
        throw new Error(`Caregivers dataset at ${this.dataPath} contains a missing or duplicate caregiver_id`);
      }
      ids.add(caregiver.caregiver_id);
      if (caregiver.active === undefined) caregiver.active = true;
    }

    this.caregivers = loaded;
    this.caregiverMap = new Map(loaded.map((caregiver) => [caregiver.caregiver_id, caregiver]));
  }

  getAll({ includeInactive = false } = {}) {
    return this.caregivers.filter((caregiver) => includeInactive || caregiver.active !== false);
  }

  getById(caregiverId) {
    const caregiver = this.caregiverMap.get(caregiverId);
    return caregiver && caregiver.active !== false ? caregiver : null;
  }

  reload() {
    this.loadData();
    return this.caregivers.length;
  }
}

const caregiverDataService = new CaregiverDataService();
caregiverDataService.CaregiverDataService = CaregiverDataService;
module.exports = caregiverDataService;
