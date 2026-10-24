const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseCaregiverCsv } = require("../../src/utils/caregiverCsv");
const caregiverDataService = require("../../src/services/caregiverData.service");

const csvPath = path.join(__dirname, "../../data/caregivers.csv");
const csvText = fs.readFileSync(csvPath, "utf8");

describe("Official caregiver CSV integration", () => {
  test("loads exactly 60 records with 52 active and 8 inactive caregivers", () => {
    const allRecords = caregiverDataService.getAll({ includeInactive: true });
    assert.equal(allRecords.length, 60);
    assert.equal(allRecords.filter((caregiver) => caregiver.active).length, 52);
    assert.equal(allRecords.filter((caregiver) => !caregiver.active).length, 8);
    assert.equal(caregiverDataService.getAll().length, 52);
  });

  test("parses semicolon lists, preserves blank tiers, and maps availability without inventing dates", () => {
    const records = parseCaregiverCsv(csvText);
    const blankTier = records.find((caregiver) => caregiver.caregiver_id === "CG_001");
    const medic = records.find((caregiver) => caregiver.caregiver_id === "CG_002");
    assert.equal(blankTier.tier, null);
    assert.deepEqual(blankTier.languages, ["Hindi", "Haryanvi"]);
    assert.ok(medic.skills.includes("wound_dressing"));
    assert.deepEqual(medic.languages, ["Hindi", "English", "Punjabi"]);
    assert.equal(medic.availability_slots[0].date, null);
    assert.equal(medic.availability_slots[0].time, "09:00");
    assert.equal(medic.availability_slots[0].end_time, "15:00");
  });

  test("rejects malformed rows and invalid required caregiver values", () => {
    assert.throws(() => parseCaregiverCsv(`${csvText}malformed,row\n`), /expected 17 columns/);
    assert.throws(() => parseCaregiverCsv(csvText.replace("CG_001,Mohit Gupta", "CG_001,")), /name.*required/);
    assert.throws(() => parseCaregiverCsv(csvText.replace("28.5575", "invalid")), /invalid base_lat/);
    assert.throws(() => parseCaregiverCsv(csvText.replace("True", "yes")), /active must be True or False/);
  });

  test("rejects duplicate IDs and missing required headers", () => {
    const duplicateRows = csvText.replace("CG_002,Mohit Bisht", "CG_001,Mohit Bisht");
    assert.throws(() => parseCaregiverCsv(duplicateRows), /duplicate caregiver_id/);
    const noTierHeader = csvText.split(/\r?\n/).map((line, index) => {
      const columns = line.split(",");
      columns.splice(11, 1);
      return columns.join(",");
    }).join("\n");
    assert.equal(parseCaregiverCsv(noTierHeader)[0].tier, null);
    assert.throws(() => parseCaregiverCsv(csvText.replace(",role,", ",")), /missing required headers.*role/);
  });
});