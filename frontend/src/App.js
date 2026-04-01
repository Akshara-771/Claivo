import { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState("");
  const [employeeGrade, setEmployeeGrade] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userCategory, setUserCategory] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !employeeGrade) {
      alert("Please fill in all required fields.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("employee_name", name);
    formData.append("business_purpose", purpose);
    formData.append("employee_grade", employeeGrade);
    formData.append("date", date);
    formData.append("user_category", userCategory);

    try {
      setLoading(true);
      setResult(null);

      const res = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      console.log("DEBUG BACKEND RESPONSE:", data);
      setResult(data);
    } catch (err) {
      console.error(err);
      alert("Upload failed. Check if FastAPI is running on port 8000.");
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: HIGHLIGHTER LOGIC ---
  const renderHighlightedPolicy = (text, target) => {
    if (!target || !text) return text;

    // Split text by the rule reference (case insensitive)
    const parts = text.split(new RegExp(`(${target})`, "gi"));

    return parts.map((part, i) =>
      part.toLowerCase() === target.toLowerCase() ? (
        <span key={i} style={styles.highlight}>
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  const statusColor = {
    Approved: "#2ecc71",
    Flagged: "#f39c12",
    Rejected: "#e74c3c",
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <header style={styles.header}>
          <h1 style={styles.title}>Claivo</h1>
          <p style={styles.subtitle}>Automated Expense Auditor</p>
        </header>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Receipt Image</label>
            <input type="file" onChange={(e) => setFile(e.target.files[0])} style={styles.fileInput} required />
          </div>

          <div style={styles.row}>
            <input placeholder="Employee Name" style={styles.input} onChange={(e) => setName(e.target.value)} required />
            <input type="date" style={styles.input} onChange={(e) => setDate(e.target.value)} required />
          </div>

          <textarea placeholder="Business Purpose (e.g. Client Dinner at Kochi Marriott)" style={styles.textarea} onChange={(e) => setPurpose(e.target.value)} required />

          <div style={styles.row}>
            <select value={userCategory} style={styles.select} onChange={(e) => setUserCategory(e.target.value)} required>
              <option value="">Category</option>
              <option value="meals">Meals</option>
              <option value="ground transportation">Transportation</option>
              <option value="accommodation">Accommodation</option>
              <option value="air travel">Air Travel</option>
              <option value="other">Other / Miscellaneous</option> {/* NEW OPTION */}
            </select>

            <select value={employeeGrade} style={styles.select} onChange={(e) => setEmployeeGrade(e.target.value)} required>
              <option value="">Grade</option>
              <option value="G1">G1</option>
              <option value="G2">G2</option>
              <option value="G3">G3</option>
              <option value="G4">G4</option>
              <option value="G5">G5</option>
            </select>
          </div>

          <button type="submit" disabled={loading} style={loading ? styles.buttonDisabled : styles.button}>
            {loading ? "Verifying Policy Compliance..." : "Analyze Claim"}
          </button>
        </form>

        {result && result.message === "Processed" && (
          <div style={{ ...styles.resultCard, borderColor: statusColor[result.status] }}>
            <div style={styles.resultHeader}>
              <span style={{ ...styles.statusBadge, backgroundColor: statusColor[result.status] }}>{result.status}</span>
              <span style={styles.riskLabel}>Risk Score: {result.risk_score}/100</span>
            </div>

            <div style={styles.previewContainer}>
              <label style={styles.label}>Receipt Evidence</label>
              <img
                src={result.receipt_url}
                alt="Receipt Preview"
                style={styles.receiptImage}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = "https://via.placeholder.com/150?text=Receipt+Syncing...";
                }}
              />
            </div>

            <div style={styles.meterContainer}>
              <div style={{
                ...styles.meterBar,
                width: `${result.risk_score}%`,
                backgroundColor: result.risk_score > 70 ? "#e74c3c" : result.risk_score > 30 ? "#f39c12" : "#2ecc71"
              }} />
            </div>

            <p style={styles.reasonText}><strong>Auditor Finding:</strong> {result.reason}</p>

            {/* --- UPDATED POLICY EVIDENCE SECTION WITH HIGHLIGHTING --- */}
            {result.policy_text_debug && (
              <details style={styles.details}>
                <summary style={styles.summary}>View Policy Evidence (RAG Chunk)</summary>
                <div style={styles.policyBox}>
                  {renderHighlightedPolicy(result.policy_text_debug, result.rule_ref)}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  // ... existing styles ...
  previewContainer: { marginTop: "15px", padding: "10px", backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #eee", textAlign: "center" },
  receiptImage: { maxWidth: "100%", maxHeight: "200px", borderRadius: "4px", marginTop: "5px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
  container: { minHeight: "100vh", backgroundColor: "#f4f7f6", display: "flex", justifyContent: "center", alignItems: "center", padding: "20px" },
  card: { backgroundColor: "#fff", width: "100%", maxWidth: "500px", padding: "40px", borderRadius: "15px", boxShadow: "0 10px 25px rgba(0,0,0,0.05)" },
  header: { textAlign: "center", marginBottom: "30px" },
  title: { margin: 0, color: "#2c3e50", fontSize: "28px", fontWeight: "700" },
  subtitle: { margin: 0, color: "#7f8c8d", fontSize: "14px" },
  form: { display: "flex", flexDirection: "column", gap: "15px" },
  row: { display: "flex", gap: "10px" },
  label: { fontSize: "12px", fontWeight: "bold", color: "#34495e", marginBottom: "5px", display: "block" },
  input: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "14px" },
  textarea: { padding: "12px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "14px", minHeight: "80px", resize: "none" },
  select: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid #ddd", backgroundColor: "#fff" },
  button: { padding: "14px", borderRadius: "8px", border: "none", backgroundColor: "#2c3e50", color: "#fff", fontWeight: "bold", cursor: "pointer", transition: "0.3s" },
  buttonDisabled: { padding: "14px", borderRadius: "8px", border: "none", backgroundColor: "#bdc3c7", color: "#fff", cursor: "not-allowed" },
  resultCard: { marginTop: "25px", padding: "20px", borderRadius: "10px", borderLeft: "5px solid", backgroundColor: "#fafafa" },
  resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
  statusBadge: { color: "#fff", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "bold" },
  riskLabel: { fontSize: "13px", color: "#7f8c8d", fontWeight: "600" },
  meterContainer: { height: "8px", backgroundColor: "#eee", borderRadius: "4px", overflow: "hidden", marginBottom: "15px" },
  meterBar: { height: "100%", transition: "width 0.5s ease" },
  reasonText: { fontSize: "14px", color: "#2c3e50", lineHeight: "1.5", margin: 0 },

  // New Styles for Highlighter
  highlight: {
    backgroundColor: "#fff3cd",
    color: "#856404",
    padding: "2px 4px",
    borderRadius: "3px",
    fontWeight: "bold",
    border: "1px solid #ffeeba"
  },
  details: {
    marginTop: '15px',
    fontSize: '12px',
    color: '#666',
    borderTop: '1px solid #eee',
    paddingTop: '10px'
  },
  summary: {
    cursor: 'pointer',
    fontWeight: 'bold',
    outline: 'none'
  },
  policyBox: {
    whiteSpace: 'pre-wrap',
    backgroundColor: '#f9f9f9',
    padding: '10px',
    borderRadius: '5px',
    marginTop: '10px',
    fontFamily: 'monospace',
    border: '1px solid #ddd',
    lineHeight: '1.4'
  }
};

export default App;