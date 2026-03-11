const express = require("express");
const path = require("path");
const ExcelJS = require("exceljs");
const Fuse = require("fuse.js");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const workbookPath = path.join(
  __dirname,
  "data",
  "Phi Chi Theta Zeta Nu Alumni (Updated SP26).xlsx"
);

let alumniData = [];
let fuse = null;

const hasGemini = !!process.env.GEMINI_API_KEY;
const genAI = hasGemini
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const model = genAI
  ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" })
  : null;

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalize(text) {
  return cleanValue(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function buildSearchBlob(row) {
  return [
    row.fullName,
    row.firstName,
    row.lastName,
    row.email,
    row.phone,
    row.graduationYear,
    row.pledgeClass,
    row.currentCity,
    row.employer,
    row.position
  ]
    .filter(Boolean)
    .join(" | ");
}

function scoreRowAgainstTerms(row, terms) {
  let score = 0;
  const haystack = normalize(buildSearchBlob(row));

  for (const term of terms) {
    const t = normalize(term);
    if (!t) continue;

    if (normalize(row.fullName).includes(t)) score += 10;
    if (normalize(row.employer).includes(t)) score += 7;
    if (normalize(row.position).includes(t)) score += 6;
    if (normalize(row.currentCity).includes(t)) score += 5;
    if (normalize(row.pledgeClass).includes(t)) score += 5;
    if (normalize(String(row.graduationYear)).includes(t)) score += 5;
    if (haystack.includes(t)) score += 3;
  }

  return score;
}

function extractSimpleFilters(query) {
  const q = normalize(query);

  const filters = {
    company: "",
    city: "",
    role: "",
    pledgeClass: "",
    graduationYear: "",
    name: ""
  };

  const years = q.match(/\b(19|20)\d{2}\b/g);
  if (years && years.length > 0) {
    filters.graduationYear = years[0];
  }

  const pledgeClasses = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta",
    "eta", "theta", "iota", "kappa", "lambda", "mu",
    "nu", "xi", "omicron", "pi", "rho", "sigma",
    "tau", "upsilon", "phi", "chi", "psi", "omega"
  ];

  for (const pc of pledgeClasses) {
    if (q.includes(pc)) {
      filters.pledgeClass = pc;
      break;
    }
  }

  const cityHints = [
    "new york", "nyc", "chicago", "columbus", "cincinnati", "cleveland",
    "los angeles", "san francisco", "california", "boston", "seattle",
    "austin", "dallas", "miami", "atlanta", "washington", "dc", "philadelphia"
  ];

  for (const city of cityHints) {
    if (q.includes(city)) {
      filters.city = city;
      break;
    }
  }

  const roleHints = [
    "venture capital", "private equity", "investment banking", "banking",
    "consulting", "software", "engineering", "marketing", "sales",
    "product", "finance", "accounting", "startup", "healthcare", "legal"
  ];

  for (const role of roleHints) {
    if (q.includes(role)) {
      filters.role = role;
      break;
    }
  }

  const stopWords = new Set([
    "find", "show", "me", "people", "person", "someone", "anyone", "who",
    "working", "work", "in", "at", "from", "the", "a", "an", "with",
    "for", "alumni", "pledge", "class", "graduating"
  ]);

  const words = q.split(/\s+/).filter(Boolean);
  const possibleImportantWords = words.filter(
    (w) => !stopWords.has(w) && !/\b(19|20)\d{2}\b/.test(w)
  );

  if (!filters.role && possibleImportantWords.length >= 1) {
    filters.company = possibleImportantWords.join(" ");
  }

  return filters;
}

async function interpretQueryWithAI(query) {
  if (!model) return null;

  try {
    const prompt = `
You are parsing search queries for an alumni database.

Return ONLY valid JSON.

Use exactly this structure:
{
  "name": "",
  "company": "",
  "city": "",
  "role": "",
  "pledgeClass": "",
  "graduationYear": "",
  "keywords": []
}

Rules:
- Keep values short.
- If unknown, use an empty string.
- "keywords" should contain useful search terms from the query.
- Do not include any explanation.
- Output raw JSON only.

Example query:
"people in venture capital in chicago"

Example output:
{
  "name": "",
  "company": "",
  "city": "chicago",
  "role": "venture capital",
  "pledgeClass": "",
  "graduationYear": "",
  "keywords": ["venture capital", "chicago"]
}

Query:
${query}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      name: cleanValue(parsed.name),
      company: cleanValue(parsed.company),
      city: cleanValue(parsed.city),
      role: cleanValue(parsed.role),
      pledgeClass: cleanValue(parsed.pledgeClass),
      graduationYear: cleanValue(parsed.graduationYear),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map(cleanValue).filter(Boolean)
        : []
    };
  } catch (err) {
    console.log("Gemini parse failed, falling back:", err.message);
    return null;
  }
}

function matchesFilter(rowValue, filterValue) {
  if (!filterValue) return true;
  return normalize(rowValue).includes(normalize(filterValue));
}

function smartFilterRows(rows, filters) {
  return rows.filter((row) => {
    const roleCombined = `${row.position} ${row.employer}`;

    return (
      matchesFilter(row.fullName, filters.name) &&
      matchesFilter(row.employer, filters.company) &&
      matchesFilter(row.currentCity, filters.city) &&
      matchesFilter(roleCombined, filters.role) &&
      matchesFilter(row.pledgeClass, filters.pledgeClass) &&
      matchesFilter(String(row.graduationYear), filters.graduationYear)
    );
  });
}

function rankResults(results, query, extraTerms = []) {
  const queryTerms = normalize(query).split(/\s+/).filter(Boolean);
  const terms = [...queryTerms, ...extraTerms].filter(Boolean);

  return results
    .map((row) => ({
      ...row,
      matchScore: scoreRowAgainstTerms(row, terms)
    }))
    .sort((a, b) => b.matchScore - a.matchScore);
}

async function loadAlumni() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const worksheet =
    workbook.getWorksheet("All Alumni Unfiltered") ||
    workbook.getWorksheet(1);

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const firstName = cleanValue(row.getCell(1).value);
    const lastName = cleanValue(row.getCell(2).value);
    const phone = cleanValue(row.getCell(3).value);
    const email = cleanValue(row.getCell(4).value);
    const graduationYear = cleanValue(row.getCell(5).value);
    const pledgeClass = cleanValue(row.getCell(6).value);
    const currentCity = cleanValue(row.getCell(7).value);
    const employer = cleanValue(row.getCell(8).value);
    const position = cleanValue(row.getCell(9).value);

    const hasUsefulData =
      firstName || lastName || email || employer || position || currentCity;

    if (!hasUsefulData) return;

    rows.push({
      id: rowNumber,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      phone,
      email,
      graduationYear,
      pledgeClass,
      currentCity,
      employer,
      position
    });
  });

  alumniData = rows;

  fuse = new Fuse(alumniData, {
    includeScore: true,
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "fullName", weight: 0.35 },
      { name: "employer", weight: 0.2 },
      { name: "position", weight: 0.15 },
      { name: "currentCity", weight: 0.1 },
      { name: "pledgeClass", weight: 0.1 },
      { name: "graduationYear", weight: 0.05 },
      { name: "email", weight: 0.03 },
      { name: "phone", weight: 0.02 }
    ]
  });

  console.log(`Loaded ${alumniData.length} alumni rows`);
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    count: alumniData.length,
    geminiEnabled: hasGemini
  });
});

app.post("/api/search", async (req, res) => {
  try {
    const query = cleanValue(req.body.query);

    if (!query) {
      return res.status(400).json({ message: "Please enter a search." });
    }

    let aiFilters = await interpretQueryWithAI(query);

    if (!aiFilters) {
      const simpleFilters = extractSimpleFilters(query);
      aiFilters = {
        name: simpleFilters.name || "",
        company: simpleFilters.company || "",
        city: simpleFilters.city || "",
        role: simpleFilters.role || "",
        pledgeClass: simpleFilters.pledgeClass || "",
        graduationYear: simpleFilters.graduationYear || "",
        keywords: normalize(query).split(/\s+/).filter(Boolean)
      };
    }

    const structuredResults = smartFilterRows(alumniData, aiFilters);

    const fuzzyResults = fuse.search(query).map((r) => ({
      ...r.item,
      fuzzyScore: r.score
    }));

    const combinedMap = new Map();

    for (const row of structuredResults) {
      combinedMap.set(row.id, row);
    }

    for (const row of fuzzyResults) {
      combinedMap.set(row.id, row);
    }

    let combinedResults = Array.from(combinedMap.values());

    combinedResults = rankResults(combinedResults, query, aiFilters.keywords);
    combinedResults = combinedResults.filter((row) => row.matchScore >= 3);
    combinedResults = combinedResults.slice(0, 20);

    if (combinedResults.length === 0) {
      return res.json({
        message: "No result found.",
        results: []
      });
    }

    return res.json({
      message: `${combinedResults.length} result(s) found`,
      filtersUsed: aiFilters,
      results: combinedResults
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Something went wrong on the server."
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

loadAlumni().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});