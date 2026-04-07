import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Users, AlertOctagon, TrendingDown, FileText, Search, X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

export default function AdminPage() {
  const [claims, setClaims] = useState([]);
  const [stats, setStats] = useState({ total: 0, highRisk: 0, savings: 0 });
  const [toasts, setToasts] = useState([]);
  const prevCountRef = useRef(0);
  const initialLoadRef = useRef(false);

  const addToast = (message) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 12000);
  };


  const exportToCSV = () => {
    if (selectedClaims.size === 0) return alert("Select claims to export first!");

    const claimsToExport = claims.filter(c => selectedClaims.has(c.claim_id));

    // 1. Define CSV Headers
    const headers = ["Claim ID", "Employee", "Grade", "Date", "Category", "Amount", "Currency", "Status"].join(",");

    // 2. Map Data to Rows
    const rows = claimsToExport.map(c => [
      c.claim_id,
      c.employee_name,
      c.employee_grade,
      c.date,
      c.category,
      c.amount,
      c.currency,
      c.status
    ].join(",")).join("\n");

    // 3. Trigger Download
    const blob = new Blob([headers + "\n" + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `payroll_batch_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const loadClaims = () => {
    fetch("https://claivo-backend.onrender.com/claims")
      .then(res => res.json())
      .then(data => {
        if (data.claims) {
          // pre-sort by risk level descending
          const sorted = data.claims.sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
          setClaims(sorted);

          let highRisk = 0;
          let savings = 0;
          sorted.forEach(c => {
            if (c.risk_score >= 70 || c.status === "Rejected") highRisk++;
            if (c.status === "Rejected") savings += parseFloat(c.total_amount_usd || 0);
          });
          setStats({ total: sorted.length, highRisk, savings: savings.toFixed(2) });
          setStats({ total: sorted.length, highRisk, savings: savings.toFixed(2) });

          // Notify Auditor if a new claim (higher absolute count) is detected after initial load
          if (initialLoadRef.current && sorted.length > prevCountRef.current) {
            const newClaimsCount = sorted.length - prevCountRef.current;
            addToast(`New Claim Submitted! (${newClaimsCount} new)`);
          }
          prevCountRef.current = sorted.length;
          initialLoadRef.current = true;
        }
      })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    loadClaims();
    const timer = setInterval(loadClaims, 5000);
    return () => clearInterval(timer);
  }, []);

  // Transform claims data for charts
  const prepareChartData = (allClaims) => {
    // 1. Category Breakdown
    const categories = {};
    // 2. Status Distribution
    const statuses = { Approved: 0, Rejected: 0, Flagged: 0 };

    allClaims.forEach(c => {
      const cat = c.category || 'Other';
      categories[cat] = (categories[cat] || 0) + parseFloat(c.amount || 0);
      if (statuses[c.status] !== undefined) statuses[c.status]++;
    });

    const barData = Object.keys(categories).map(key => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      amount: categories[key]
    }));

    const pieData = [
      { name: 'Approved', value: statuses.Approved, fill: 'var(--status-green)' },
      { name: 'Rejected', value: statuses.Rejected, fill: 'var(--status-red)' },
      { name: 'Flagged', value: statuses.Flagged, fill: 'var(--status-yellow)' },
    ];

    return { barData, pieData };
  };

  const { barData, pieData } = prepareChartData(claims);

  const badgeClass = (status) => {
    if (status === "Approved") return "green";
    if (status === "Rejected") return "red";
    return "yellow";
  };

  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem("adminActiveTab") || "pending");

  useEffect(() => {
    sessionStorage.setItem("adminActiveTab", activeTab);
  }, [activeTab]);

  const [showPolicyDrawer, setShowPolicyDrawer] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [gradeFilter, setGradeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");
  const [sortBy, setSortBy] = useState("risk_high");

  const [selectedClaims, setSelectedClaims] = useState(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSelectedClaims(new Set());
  }, [activeTab, searchTerm, gradeFilter, statusFilter, categoryFilter, dateFilter]);

  const pendingClaims = claims.filter((c) => {
    if (c.is_settled) return false;
    try {
      const ai = JSON.parse(c.ai_details || "{}");
      // Hide Date Matcher claims from auditor's 'Action Required' queue
      if (ai.rule_reference === "Date Matcher") return false;
    } catch (e) { }
    return true;
  });
  const finalizedClaims = claims.filter((c) => c.is_settled);
  let displayedClaims = activeTab === "pending" ? pendingClaims : finalizedClaims;

  displayedClaims = displayedClaims.filter(claim => {
    const searchMatch =
      (claim.business_purpose || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (claim.employee_name || "").toLowerCase().includes(searchTerm.toLowerCase());

    const gradeMatch = gradeFilter === "All" || claim.employee_grade === gradeFilter;
    const statusMatch = statusFilter === "All" || claim.status === statusFilter;
    const categoryMatch = categoryFilter === "All" || (claim.category || "").toLowerCase() === categoryFilter.toLowerCase();
    const dateMatch = !dateFilter || claim.date === dateFilter;

    return searchMatch && gradeMatch && statusMatch && categoryMatch && dateMatch;
  }).sort((a, b) => {
    if (sortBy === "risk_low") return (a.risk_score || 0) - (b.risk_score || 0);
    if (sortBy === "risk_high") return (b.risk_score || 0) - (a.risk_score || 0);
    if (sortBy === "latest") return new Date(b.date || 0) - new Date(a.date || 0);
    if (sortBy === "oldest") return new Date(a.date || 0) - new Date(b.date || 0);
    return 0;
  });

  const handleToggleSelect = (claimId) => {
    const newKeys = new Set(selectedClaims);
    if (newKeys.has(claimId)) newKeys.delete(claimId);
    else newKeys.add(claimId);
    setSelectedClaims(newKeys);
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedClaims(new Set(displayedClaims.map(c => c.claim_id)));
    } else {
      setSelectedClaims(new Set());
    }
  };

  const handleBulkAction = async (decision) => {
    let reason = "Bulk " + decision;
    if (decision === "Rejected") {
      reason = prompt("Please enter a reason for rejecting the selected claims:", "Does not comply with policy");
      if (!reason) return; // cancelled
    } else {
      if (!window.confirm(`Are you sure you want to approve ${selectedClaims.size} claims?`)) return;
    }

    setIsSubmitting(true);
    try {
      await Promise.all(
        Array.from(selectedClaims).map(id =>
          fetch(`https://claivo-backend.onrender.com/claims/${id}/decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, reason })
          })
        )
      );
      loadClaims();
      setSelectedClaims(new Set());
    } catch (err) {
      console.error(err);
      alert("Bulk action failed");
    } finally {
      setIsSubmitting(false);
    }
  };
  useEffect(() => {
    const handleKey = (e) => {
      if (selectedClaims.size === 0) return;

      if (e.key === "a") handleBulkAction("Approved");
      if (e.key === "r") handleBulkAction("Rejected");
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedClaims]);

  return (
    <div style={{ padding: '4rem 2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <style>{`
        .card { transition: all 0.25s ease; }
        .card:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,0.08); }

        @keyframes slideUpFade {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .stagger-1 { animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
        .stagger-2 { animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
        .stagger-3 { animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }
        .stagger-4 { animation: slideUpFade 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both; }
      `}</style>
      <div className="stagger-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '3rem' }}>
        <div>
          <h1 className="heading-section" style={{ marginBottom: '10px' }}>Control Center</h1>
          <p style={{ color: 'var(--text-muted)' }}>Monitor and audit company expenses.</p>
        </div>
      </div>

      {/* TOAST OVERLAY */}
      <div style={{ position: 'fixed', top: '2rem', right: '2rem', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            background: '#000', color: '#fff', padding: '1rem 1.5rem', borderRadius: '8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: '300px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)', fontSize: '0.9rem', fontWeight: 600,
            animation: 'slideIn 0.3s ease-out forwards'
          }}>
            <span>{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(toast => toast.id !== t.id))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '1rem' }}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* STATS BAR */}
      <div className="stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem', marginBottom: '4rem' }}>
        <div className="card" style={{ padding: '2rem', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
          <Users size={24} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
          <div style={{ fontSize: '2.5rem', fontWeight: 800 }}>{stats.total}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Total Claims Processed</div>
        </div>
        <div className="card" style={{ padding: '2rem', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
          <AlertOctagon size={24} color="var(--status-red)" style={{ marginBottom: '1rem' }} />
          <div style={{ fontSize: '2.5rem', fontWeight: 800 }}>{stats.highRisk}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>High Risk / Rejected</div>
          <div style={{ marginTop: "1rem", color: "#666", fontSize: "0.9rem" }}>
            {stats.highRisk > stats.total * 0.3
              ? "⚠️ High anomaly rate detected this week"
              : "✅ Expense patterns look normal"}
          </div>
        </div>
        <div className="card" style={{ padding: '2rem', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
          <TrendingDown size={24} color="var(--status-green)" style={{ marginBottom: '1rem' }} />
          <div style={{ fontSize: '2.5rem', fontWeight: 800 }}>${stats.savings}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Protected Savings</div>
        </div>
      </div>

      <div className="stagger-3" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '4rem' }}>
        {/* COLUMN 1: SPENDING BY CATEGORY */}
        <div className="card" style={{
          padding: '2rem', backgroundColor: '#fff', border: '1px solid var(--glass-border)', borderRadius: '12px',
          opacity: claims.length ? 1 : 0,
          transform: claims.length ? "translateY(0)" : "translateY(20px)",
          transition: "all 0.6s ease"
        }}>
          <h3 style={{ marginBottom: '2rem', fontSize: '1.1rem', fontWeight: 800 }}>Spending Distribution ($)</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip cursor={{ fill: '#f5f5f5' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="amount" fill="#000" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* COLUMN 2: AUDIT OUTCOMES */}
        <div className="card" style={{
          padding: '2rem', backgroundColor: '#fff', border: '1px solid var(--glass-border)', borderRadius: '12px',
          opacity: claims.length ? 1 : 0,
          transform: claims.length ? "translateY(0)" : "translateY(20px)",
          transition: "all 0.6s ease"
        }}>
          <h3 style={{ marginBottom: '2rem', fontSize: '1.1rem', fontWeight: 800 }}>Audit Health</h3>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* TABS & LOWER TABLE AREA */}
      <div className="stagger-4">
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <button
            onClick={() => setActiveTab("pending")}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              fontWeight: activeTab === "pending" ? 800 : 600,
              color: activeTab === "pending" ? '#000' : '#aaa',
              cursor: 'pointer',
              borderBottom: activeTab === "pending" ? '2px solid #000' : 'none',
              paddingBottom: '5px'
            }}
          >
            Action Required ({pendingClaims.length})
          </button>
          <button
            onClick={() => setActiveTab("finalized")}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              fontWeight: activeTab === "finalized" ? 800 : 600,
              color: activeTab === "finalized" ? '#000' : '#aaa',
              cursor: 'pointer',
              borderBottom: activeTab === "finalized" ? '2px solid #000' : 'none',
              paddingBottom: '5px'
            }}
          >
            Finalized ({finalizedClaims.length})
          </button>
        </div>

        {/* FILTER & SEARCH BAR */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', marginBottom: '2rem', backgroundColor: '#fff', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
            <input
              type="text"
              placeholder="Search purpose or employee..."
              className="minimal-input"
              style={{ paddingLeft: '35px', margin: 0, width: '100%' }}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select className="minimal-input" style={{ margin: 0, width: '150px' }} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="Approved">Approved</option>
            <option value="Flagged">Flagged</option>
            <option value="Rejected">Rejected</option>
          </select>

          <select className="minimal-input" style={{ margin: 0, width: '150px' }} onChange={(e) => setGradeFilter(e.target.value)}>
            <option value="All">All Grades</option>
            <option value="G1">G1</option>
            <option value="G2">G2</option>
            <option value="G3">G3</option>
            <option value="G4">G4</option>
            <option value="G5">G5</option>
          </select>

          <select className="minimal-input" style={{ margin: 0, width: '150px' }} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="All">All Categories</option>
            <option value="accommodation">Accommodation</option>
            <option value="meals">Meals</option>
            <option value="air travel">Air Travel</option>
            <option value="ground transportation">Transportation</option>
            <option value="other">Other</option>
          </select>

          <input
            type="date"
            className="minimal-input"
            style={{ margin: 0, width: '150px' }}
            onChange={(e) => setDateFilter(e.target.value)}
          />
          <select
            className="minimal-input"
            style={{ margin: 0, width: '160px' }}
            onChange={(e) => setSortBy(e.target.value)}
            value={sortBy}
          >
            <option value="risk_high">Risk (High to Low)</option>
            <option value="risk_low">Risk (Low to High)</option>
            <option value="latest">Latest First</option>
            <option value="oldest">Oldest First</option>
          </select>
        </div>

        {/* BULK ACTIONS BAR */}
        {selectedClaims.size > 0 && (
          <div style={{ backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '1rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: '#0369a1' }}>{selectedClaims.size} claims selected</span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="minimal-button"
                style={{ backgroundColor: '#fff', color: '#000', border: '1px solid #ddd' }}
                onClick={exportToCSV}
              >
                Export Batch (CSV)
              </button>
              {activeTab === "pending" && (
                <>
                  <button
                    className="minimal-button"
                    style={{ backgroundColor: 'var(--status-green)' }}
                    onClick={() => handleBulkAction("Approved")}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Bulk Approve"}
                  </button>
                  <button
                    className="minimal-button"
                    style={{ backgroundColor: 'var(--status-red)' }}
                    onClick={() => handleBulkAction("Rejected")}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Processing..." : "Bulk Reject"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {/* MASTER TABLE */}
        <div style={{ backgroundColor: '#fff', border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden' }}>
          <table className="minimal-table" style={{ margin: 0 }}>
            <thead style={{ backgroundColor: '#fafafa' }}>
              <tr>
                <th style={{ width: '40px' }}>
                  <input type="checkbox" onChange={handleSelectAll} checked={displayedClaims.length > 0 && selectedClaims.size === displayedClaims.length} />
                </th>
                <th>Employee</th>
                <th>Date</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Risk Score</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayedClaims.map((claim) => (
                <tr key={claim.claim_id}>
                  <td>
                    <input type="checkbox" checked={selectedClaims.has(claim.claim_id)} onChange={() => handleToggleSelect(claim.claim_id)} />
                  </td>
                  <td style={{ fontWeight: 600 }}>{claim.employee_name} <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: '5px' }}>{claim.employee_grade}</span></td>
                  <td>{claim.date}</td>
                  <td style={{ textTransform: 'capitalize' }}>{claim.category}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {claim.amount} {claim.currency}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#888' }}>
                      ≈ ${claim.total_amount_usd} USD
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '50px', height: '6px', backgroundColor: '#eee', borderRadius: '3px' }}>
                        <div style={{
                          height: '100%',
                          width: `${claim.risk_score}%`,
                          backgroundColor: claim.risk_score >= 70 ? 'var(--status-red)' : claim.risk_score >= 35 ? 'var(--status-yellow)' : 'var(--status-green)',
                          borderRadius: '3px'
                        }}></div>
                      </div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{claim.risk_score}/100</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${badgeClass(claim.status)}`}>{claim.status}</span>
                  </td>
                  <td>
                    <Link to={`/audit/${claim.claim_id}`} style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.85rem' }}>
                      {activeTab === "pending" ? "Review \u2192" : "View Details \u2192"}
                    </Link>
                  </td>
                </tr>
              ))}
              {displayedClaims.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ textAlign: "center", padding: "3rem" }}>
                      <p style={{ fontSize: "1rem", color: "#999" }}>
                        No matching claims
                      </p>
                      <p style={{ fontSize: "0.85rem", color: "#bbb" }}>
                        Try adjusting filters or search terms
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FLOATING VIEW POLICY BUTTON */}
      <button
        onClick={() => setShowPolicyDrawer(true)}
        style={{
          position: 'fixed', bottom: '30px', right: '30px',
          backgroundColor: '#000', color: '#fff',
          padding: '12px 20px', borderRadius: '30px',
          border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
          cursor: 'pointer', fontSize: '1rem', fontWeight: 600,
          zIndex: 1000, display: 'flex', alignItems: 'center', gap: '8px',
          transition: 'transform 0.2s ease',
        }}
        onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
        onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
      >
        <FileText size={18} /> View Policy
      </button>

      {/* SIDE DRAWER */}
      <div style={{
        position: 'fixed', top: 0, right: showPolicyDrawer ? 0 : '-600px',
        width: '600px', height: '100vh',
        backgroundColor: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
        zIndex: 1001, display: 'flex', flexDirection: 'column',
        transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={20} /> Company Policy
          </h3>
          <button onClick={() => setShowPolicyDrawer(false)} style={{ background: 'none', border: 'none', fontSize: '2rem', cursor: 'pointer', lineHeight: 1, color: '#999' }}>&times;</button>
        </div>
        <div style={{ flex: 1, backgroundColor: '#f9f9f9', position: 'relative' }}>
          <iframe
            src="http://127.0.0.1:8000/policy_pdf"
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Company Policy"
          />
        </div>
      </div>
    </div>
  );
}
