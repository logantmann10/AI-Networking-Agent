const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");
const exampleChips = document.querySelectorAll(".example-chip");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderResults(data) {
  statusDiv.textContent = data.message || "";

  if (!data.results || data.results.length === 0) {
    resultsDiv.innerHTML = `<div class="empty">No result found.</div>`;
    return;
  }

  resultsDiv.innerHTML = data.results
    .map((person) => {
      return `
        <div class="card">
          <h3>${escapeHtml(person.fullName || "Unknown Name")}</h3>
          <div class="card-grid">
            <div>
              <div class="field-label">Employer</div>
              <div class="field-value">${escapeHtml(person.employer || "-")}</div>
            </div>
            <div>
              <div class="field-label">Position</div>
              <div class="field-value">${escapeHtml(person.position || "-")}</div>
            </div>
            <div>
              <div class="field-label">Current City</div>
              <div class="field-value">${escapeHtml(person.currentCity || "-")}</div>
            </div>
            <div>
              <div class="field-label">Graduation Year</div>
              <div class="field-value">${escapeHtml(person.graduationYear || "-")}</div>
            </div>
            <div>
              <div class="field-label">Pledge Class</div>
              <div class="field-value">${escapeHtml(person.pledgeClass || "-")}</div>
            </div>
            <div>
              <div class="field-label">Phone</div>
              <div class="field-value">${escapeHtml(person.phone || "-")}</div>
            </div>
            <div style="grid-column: 1 / -1;">
              <div class="field-label">Email</div>
              <div class="field-value">${escapeHtml(person.email || "-")}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function runSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    statusDiv.textContent = "Please enter a search.";
    resultsDiv.innerHTML = "";
    return;
  }

  statusDiv.textContent = "Searching...";
  resultsDiv.innerHTML = "";

  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    renderResults(data);
  } catch (error) {
    statusDiv.textContent = "Something went wrong.";
    resultsDiv.innerHTML = `<div class="empty">Server error.</div>`;
  }
}

searchBtn.addEventListener("click", runSearch);

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runSearch();
  }
});

exampleChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    searchInput.value = chip.textContent;
    runSearch();
  });
});