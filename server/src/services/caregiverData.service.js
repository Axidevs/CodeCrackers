/**
 * CURA Caregiver Dataset In-Memory Loader
 * Reads and indexes the synthetic caregivers profiles on startup.
 */

const fs = require("fs");
const path = require("path");
const env = require("../config/env");

class CaregiverDataService {
  constructor() {
    this.caregivers = [];
    this.caregiverMap = new Map();
    this.loadData();
  }

  loadData() {
    try {
      const filePath = env.DATASET_PATH;
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        this.caregivers = JSON.parse(raw);
        this.caregiverMap.clear();
        for (const cg of this.caregivers) {
          this.caregiverMap.set(cg.caregiver_id, cg);
        }
      } else {
        console.warn(`Caregivers dataset file not found at ${filePath}. Initializing empty list.`);
        this.caregivers = [];
      }
    } catch (err) {
      console.error("Failed to load caregivers dataset:", err.message);
      this.caregivers = [];
    }
  }

  getAll() {
    return [...this.caregivers];
  }

  getById(caregiverId) {
    return this.caregiverMap.get(caregiverId) || null;
  }

  reload() {
    this.loadData();
    return this.caregivers.length;
  }
}

const caregiverDataService = new CaregiverDataService();
module.exports = caregiverDataService;
