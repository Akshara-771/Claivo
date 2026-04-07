import { useState, useEffect, useRef } from "react";
import { Upload, FileText, ArrowRight, CheckCircle, AlertTriangle, XCircle, ArrowDown, Trash2, X } from "lucide-react";
import hero_image from "../assets/hero-image.jpg";
import { Search, Filter } from "lucide-react";
export default function SubmitPage() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeGrade, setEmployeeGrade] = useState("");
  const [userCategory, setUserCategory] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("latest");
  const [isHeroLoaded, setIsHeroLoaded] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const prevHistoryRef = useRef({});
  const initialLoadRef = useRef(false);

  // Set unread to 0 when opening drawer
  useEffect(() => {
    if (isDrawerOpen) setUnreadCount(0);
  }, [isDrawerOpen]);

  const addNotification = (message) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [{ id, message, timestamp: new Date().toLocaleTimeString() }, ...prev]);
    setUnreadCount((prev) => prev + 1);
  };

  const [offset, setOffset] = useState(0);
  const getNotifiedClaimsKey = () => {
    const storedName = (localStorage.getItem("demo_employee_name") || "anonymous").trim().toLowerCase();
    return `demo_notified_claims_${storedName}`;
  };

  const getNotifiedClaimIds = () => {
    try {
      const raw = localStorage.getItem(getNotifiedClaimsKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  };

  const saveNotifiedClaimIds = (idSet) => {
    localStorage.setItem(getNotifiedClaimsKey(), JSON.stringify(Array.from(idSet)));
  };

  const filteredHistory = history.filter(claim => {
    const matchesSearch = (claim.business_purpose || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (claim.employee_name || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "All" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    if (sortBy === "risk_low") return (a.risk_score || 0) - (b.risk_score || 0);
    if (sortBy === "risk_high") return (b.risk_score || 0) - (a.risk_score || 0);
    if (sortBy === "latest") return new Date(b.date || 0) - new Date(a.date || 0);
    if (sortBy === "oldest") return new Date(a.date || 0) - new Date(b.date || 0);
    return 0;
  });

  useEffect(() => {
    // 2. PRE-LOAD THE IMAGE MANUALLY
    const img = new Image();
    img.src = hero_image;
    img.onload = () => setIsHeroLoaded(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setOffset(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setFormVisible(true);
        }
      },
      { threshold: 0.2 }
    );

    if (formRef.current) observer.observe(formRef.current);

    return () => {
      if (formRef.current) observer.unobserve(formRef.current);
    };
  }, []);

  const formRef = useRef(null);
  const historyRef = useRef(null);

  const fetchHistory = async () => {
    try {
      const res = await fetch("https://claivo-backend.onrender.com/claims");
      const data = await res.json();
      if (data.claims) {
        let filtered = data.claims;
        const storedName = localStorage.getItem("demo_employee_name");
        if (storedName) {
          filtered = data.claims.filter(c => c.employee_name === storedName);
        }

        if (initialLoadRef.current) {
          const notifiedIds = getNotifiedClaimIds();
          filtered.forEach((claim) => {
            const oldClaim = prevHistoryRef.current[claim.claim_id];
            // Notify for newly finalized claims, and persist so refresh/reopen doesn't miss it.
            const becameFinalized = oldClaim && !oldClaim.is_settled && claim.is_settled;
            const finalizedButUnnotified = claim.is_settled && !notifiedIds.has(claim.claim_id);
            if (becameFinalized || finalizedButUnnotified) {
              addNotification(`Auditor Decision: Your claim for ${claim.business_purpose} was ${claim.status}!`);
              notifiedIds.add(claim.claim_id);
            }
          });
          saveNotifiedClaimIds(notifiedIds);
        }

        const newRefMap = {};
        filtered.forEach(c => newRefMap[c.claim_id] = c);
        prevHistoryRef.current = newRefMap;
        initialLoadRef.current = true;

        setHistory(filtered);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchHistory();
    const timer = setInterval(fetchHistory, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !employeeGrade) return alert("Missing fields");

    localStorage.setItem("demo_employee_name", name);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("employee_name", name);
    formData.append("employee_email", employeeEmail);
    formData.append("business_purpose", purpose);
    formData.append("employee_grade", employeeGrade);
    formData.append("date", date);
    formData.append("user_category", userCategory);

    try {
      setLoading(true);
      setResult(null);

      const res = await fetch("https://claivo-backend.onrender.com/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setResult(data);
      fetchHistory(); // refresh history
    } catch (err) {
      console.error(err);
      alert("Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  const StatusIcon = ({ status }) => {
    if (status === "Approved") return <CheckCircle size={16} color="var(--status-green)" />;
    if (status === "Rejected") return <XCircle size={16} color="var(--status-red)" />;
    return <AlertTriangle size={16} color="var(--status-yellow)" />;
  };

  const handleDeleteClaim = async (claimId) => {
    if (!window.confirm("Are you sure you want to delete this claim?")) return;

    try {
      const res = await fetch(`https://claivo-backend.onrender.com/claims/${claimId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        fetchHistory(); // refresh logic to pull the latest db without the deleted row
      } else {
        alert("Failed to delete claim.");
      }
    } catch (err) {
      console.error(err);
      alert("Error occurred while deleting claim.");
    }
  };

  return (
    <div>
      {/* FLOATING NOTIFICATION BUTTON */}
      <button
        onClick={() => setIsDrawerOpen(true)}
        style={{
          position: 'fixed', right: '1rem', bottom: '1rem', zIndex: 9998,
          background: '#000', color: '#fff', border: 'none', borderRadius: '50px',
          padding: '12px 24px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
          boxShadow: '0 4px 15px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '8px',
          transition: 'transform 0.2s'
        }}
      >
        <span>🔔 Notifications</span>
        {unreadCount > 0 && (
          <span style={{ background: 'var(--status-red)', color: '#fff', borderRadius: '50%', padding: '2px 8px', fontSize: '0.8rem' }}>
            {unreadCount}
          </span>
        )}
      </button>

      {/* OUTSIDE CLICK OVERLAY */}
      {isDrawerOpen && (
        <div
          onClick={() => setIsDrawerOpen(false)}
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9998 }}
        />
      )}

      {/* NOTIFICATION DRAWER */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, width: '350px', height: '100vh', zIndex: 9999,
          background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', borderLeft: '1px solid var(--glass-border)',
          transform: isDrawerOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex', flexDirection: 'column', boxShadow: '-5px 0 25px rgba(0,0,0,0.1)'
        }}
      >
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>Notifications ({notifications.length})</h3>
          <button onClick={() => setIsDrawerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {notifications.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>No new notifications</div>
          ) : (
            notifications.map((t) => (
              <div key={t.id} style={{
                background: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)',
                display: 'flex', flexDirection: 'column', gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#000', lineHeight: '1.4' }}>{t.message}</span>
                  <button onClick={() => setNotifications(prev => prev.filter(toast => toast.id !== t.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    <X size={14} color="var(--text-muted)" />
                  </button>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.timestamp}</span>
              </div>
            ))
          )}
        </div>
        {notifications.length > 0 && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--glass-border)' }}>
            <button onClick={() => { setNotifications([]); setUnreadCount(0); }} className="minimal-button" style={{ width: '100%', justifyContent: 'center' }}>
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* HERO SECTION */}
      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "4rem 1rem",
          overflow: "hidden",
          backgroundColor: "#1a1a1a",
        }}
      >
        {/* PARALLAX IMAGE */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "120%",
            transform: `translateY(${offset * 0.4}px)`,
            zIndex: 0,
            filter: isHeroLoaded ? "none" : "blur(20px)",
            transition: "filter 0.8s ease-in-out",
          }}
        >
          <img
            src={hero_image}
            alt="Hero"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: isHeroLoaded ? 1 : 0,
              transition: "opacity 0.5s ease-in",
            }}
          />
        </div>

        {/* CONTENT */}
        <div style={{ position: "relative", zIndex: 2 }}>
          <h1 className="heading-mega" style={{ color: "#fff" }}>
            Every claim,<br />Verified.
          </h1>

          <p
            style={{
              fontSize: "1.2rem",
              color: "var(--text-muted)",
              marginBottom: "3rem",
              maxWidth: "500px",
              color: "rgba(255,255,255,0.8)"
            }}
          >
            Upload receipts in seconds. Our AI auditor verifies compliance instantly.
          </p>

          <div style={{ display: "flex", gap: "20px", marginBottom: "4rem" }}>
            <button
              className="minimal-button"
              onClick={() =>
                formRef.current?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Submit Receipt <ArrowDown size={18} />
            </button>

            <button
              className="minimal-button"
              style={{
                backgroundColor: "#fff",
                color: "#000",
                border: "1px solid #000",
              }}
              onClick={() =>
                historyRef.current?.scrollIntoView({ behavior: "smooth" })
              }
            >
              My Claims <FileText size={18} />
            </button>
          </div>
        </div>

        {/* Optional overlay for readability */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0.6))",
            zIndex: 1,
          }}
        />
      </section>

      {/* FORM SECTION */}
      <section
        ref={formRef}
        style={{
          padding: "6rem 2rem",
          backgroundColor: "#fafafa",
          display: "flex",
          justifyContent: "center",
          // 🔥 ANIMATION
          opacity: formVisible ? 1 : 0,
          transform: formVisible ? "translateY(0px)" : "translateY(60px)",
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            maxWidth: "600px",
            width: "100%",
            background: "#fff",
            padding: "2rem",
            borderRadius: "12px",
            // 🔥 ELEVATION EFFECT
            boxShadow: formVisible
              ? "0 20px 60px rgba(0,0,0,0.08)"
              : "0 10px 30px rgba(0,0,0,0.04)",
            transition: "all 0.6s ease",
          }}
        >
          <h2 className="heading-section">New Claim</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px' }}>Receipt Image (JPG, PNG, PDF)</label>
              <input type="file" onChange={(e) => setFile(e.target.files[0])} style={{ width: '100%', padding: '10px 0' }} required />
            </div>

            <div style={{ display: 'flex', gap: '20px', marginBottom: '1rem' }}>
              <input type="text" placeholder="Employee Name" className="minimal-input" style={{ flex: 1 }} onChange={e => setName(e.target.value)} required />
              <input type="date" className="minimal-input" style={{ flex: 1 }} onChange={e => setDate(e.target.value)} required />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <input type="email" placeholder="Employee Email (for notifications)" className="minimal-input" style={{ width: '100%' }} onChange={e => setEmployeeEmail(e.target.value)} required />
            </div>

            <textarea placeholder="Business Purpose (e.g. Client Dinner)" className="minimal-input" style={{ resize: 'vertical' }} onChange={e => setPurpose(e.target.value)} required />

            <div style={{ display: 'flex', gap: '20px' }}>
              <select className="minimal-input" onChange={e => setUserCategory(e.target.value)} required>
                <option value="">Category</option>
                <option value="accommodation">Accommodation</option>
                <option value="meals">Meals</option>
                <option value="air travel">Air Travel</option>
                <option value="ground transportation">Transportation</option>
                <option value="other">Other</option>
              </select>

              <select className="minimal-input" onChange={e => setEmployeeGrade(e.target.value)} required>
                <option value="">Grade</option>
                <option value="G1">G1</option>
                <option value="G2">G2</option>
                <option value="G3">G3</option>
                <option value="G4">G4</option>
                <option value="G5">G5</option>
              </select>
            </div>

            <button type="submit" className="minimal-button" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
              {loading ? "Scanning..." : "Analyze & Submit"}
            </button>
            <p style={{ textAlign: 'center', marginTop: '1rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-muted)' }} onClick={() => historyRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              Already submitted? Check My Claims
            </p>
          </form>

          {loading && (
            <div style={{ marginTop: '3rem', height: '200px', backgroundColor: '#eee', position: 'relative', overflow: 'hidden', borderRadius: '8px' }}>
              <div className="scan-overlay"></div>
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontWeight: 800, color: 'var(--text-muted)' }}>AI is scanning document...</p>
              </div>
            </div>
          )}

          {result && !loading && (
            <div className="animate-in" style={{ marginTop: '3rem', padding: '2rem', border: '1px solid var(--glass-border)', backgroundColor: '#fff', borderRadius: '8px' }}>
              {result.error ? (
                <div style={{ padding: '1rem', background: '#ffebee', color: '#c62828', borderRadius: '6px' }}>
                  <strong>Upload Error:</strong> {result.error}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Audit Result</h3>
                    <span className={`badge ${result.status === 'Approved' ? 'green' : result.status === 'Rejected' ? 'red' : 'yellow'}`}>
                      {result.status}
                    </span>
                  </div>
                  <p style={{ fontSize: '1rem', lineHeight: '1.6', marginBottom: '1rem' }}>{result.reason}</p>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <strong>Risk Score:</strong> {result.risk_score} / 100 <br />
                    <strong>Rule Ref:</strong> {result.rule_ref}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* HISTORY SECTION */}
      <section ref={historyRef} style={{ padding: '6rem 2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 className="heading-section" style={{ margin: 0 }}>My Claims</h2>

          {/* SEARCH & FILTER BAR */}
          <div style={{ display: 'flex', gap: '15px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aaa' }} />
              <input
                type="text"
                placeholder="Search purpose..."
                className="minimal-input"
                style={{ paddingLeft: '35px', margin: 0, width: '200px' }}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="minimal-input"
              style={{ margin: 0, width: '130px' }}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All Status</option>
              <option value="Approved">Approved</option>
              <option value="Flagged">Flagged</option>
              <option value="Rejected">Rejected</option>
            </select>
            <select
              className="minimal-input"
              style={{ margin: 0, width: '160px' }}
              onChange={(e) => setSortBy(e.target.value)}
              value={sortBy}
            >
              <option value="latest">Latest First</option>
              <option value="oldest">Oldest First</option>
              <option value="risk_high">Risk (High to Low)</option>
              <option value="risk_low">Risk (Low to High)</option>
            </select>
          </div>
        </div>

        {history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No claims found. Submit one above!</p>
        ) : filteredHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No claims match your search/filter.</p>
        ) : (
          <table className="minimal-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Purpose</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map(c => (
                <tr key={c.claim_id}>
                  <td>{c.date || "Unknown"}</td>
                  <td style={{ fontWeight: 600 }}>
                    {c.business_purpose || c.employee_name}
                    {c.status !== "Approved" && (
                      <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 400, marginTop: '4px' }}>
                        Reason: {(() => {
                          try { return JSON.parse(c.ai_details || "{}").reason || ""; } catch { return ""; }
                        })()}
                      </div>
                    )}
                    {c.audit_comment && (
                      <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 400, marginTop: '2px' }}>
                        Auditor Note: {c.audit_comment}
                      </div>
                    )}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{c.category}</td>
                  <td>{c.amount ? `${c.amount} ${c.currency || 'USD'}` : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <StatusIcon status={c.status} />
                      {c.is_settled ? `Finalized - ${c.status}` : c.status === "Approved" ? "Auto-Approved" : `Pending Auditor Review - ${c.status}`}
                    </div>
                  </td>
                  <td>
                    {!c.is_settled && (
                      <button
                        onClick={() => handleDeleteClaim(c.claim_id)}
                        style={{ background: 'none', border: 'none', color: 'var(--status-red)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        title="Delete Claim"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
