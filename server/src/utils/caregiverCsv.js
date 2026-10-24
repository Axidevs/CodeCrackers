const REQUIRED_HEADERS = [
  "caregiver_id",
  "name",
  "role",
  "qualification",
  "gender",
  "languages",
  "skills",
  "base_area",
  "base_lat",
  "base_lng",
  "max_radius_km",
  "rating",
  "experience_years",
  "free_from",
  "free_until",
  "active"
];

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"' && csvText[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error("Unexpected quote in unquoted CSV field");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function parseNumber(value, field, rowNumber, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`CSV row ${rowNumber}: invalid ${field} '${value}'`);
  }
  return parsed;
}

function parseList(value, field, rowNumber) {
  const values = value.split(";").map((entry) => entry.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`CSV row ${rowNumber}: ${field} must contain at least one value`);
  return values;
}

function isValidTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function parseCaregiverCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error("Caregiver CSV must include a header and at least one record");

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length > 0) throw new Error(`Caregiver CSV has duplicate headers: ${[...new Set(duplicates)].join(", ")}`);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) throw new Error(`Caregiver CSV is missing required headers: ${missingHeaders.join(", ")}`);

  const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
  const caregiverIds = new Set();
  return rows.slice(1).map((cells, rowIndex) => {
    const rowNumber = rowIndex + 2;
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${rowNumber}: expected ${headers.length} columns, found ${cells.length}`);
    }
    const value = (header) => headerIndex[header] === undefined ? "" : cells[headerIndex[header]].trim();
    const caregiverId = value("caregiver_id");
    const name = value("name");
    const role = value("role").toLowerCase();
    if (!caregiverId || !name || !role || !value("qualification") || !value("base_area")) {
      throw new Error(`CSV row ${rowNumber}: caregiver_id, name, role, qualification, and base_area are required`);
    }
    if (caregiverIds.has(caregiverId)) throw new Error(`CSV row ${rowNumber}: duplicate caregiver_id '${caregiverId}'`);
    caregiverIds.add(caregiverId);

    const lat = parseNumber(value("base_lat"), "base_lat", rowNumber, { min: -90, max: 90 });
    const lng = parseNumber(value("base_lng"), "base_lng", rowNumber, { min: -180, max: 180 });
    const serviceRadiusKm = parseNumber(value("max_radius_km"), "max_radius_km", rowNumber, { min: 0.1 });
    const rating = parseNumber(value("rating"), "rating", rowNumber, { min: 0, max: 5 });
    const experienceYears = parseNumber(value("experience_years"), "experience_years", rowNumber, { min: 0 });
    const availableFrom = value("free_from");
    const availableUntil = value("free_until");
    if (!isValidTime(availableFrom) || !isValidTime(availableUntil) || availableUntil <= availableFrom) {
      throw new Error(`CSV row ${rowNumber}: free_from/free_until must be valid increasing HH:mm times`);
    }
    const activeValue = value("active").toLowerCase();
    if (activeValue !== "true" && activeValue !== "false") {
      throw new Error(`CSV row ${rowNumber}: active must be True or False`);
    }

    return {
      caregiver_id: caregiverId,
      name,
      role,
      qualification: value("qualification"),
      gender: value("gender") || null,
      skills: parseList(value("skills"), "skills", rowNumber),
      location: { lat, lng, address: value("base_area") },
      service_radius_km: serviceRadiusKm,
      availability_slots: [{
        slot_id: `${caregiverId}_${availableFrom.replace(":", "")}`,
        date: null,
        time: availableFrom,
        end_time: availableUntil,
        status: "available"
      }],
      languages: parseList(value("languages"), "languages", rowNumber),
      rating,
      experience_years: experienceYears,
      tier: value("tier") || null,
      active: activeValue === "true"
    };
  });
}

module.exports = { parseCsvRows, parseCaregiverCsv };