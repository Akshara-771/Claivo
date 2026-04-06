import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";

export default function AuditDetail() {
  const { claim_id } = useParams();
  const navigate = useNavigate();
  const [claim, setClaim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [zoomStyle, setZoomStyle] = useState({ transformOrigin: 'center' });
  const [showLightbox, setShowLightbox] = useState(false);

  const handleMouseMove = (e) => {
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.pageX - left) / width) * 100;
    const y = ((e.pageY - top - window.scrollY) / height) * 100;
    setZoomStyle({ transformOrigin: `${x}% ${y}%`, transform: 'scale(2)' });
  };

  useEffect(() => {
    fetch(`http://127.0.0.1:8000/claims/${claim_id}`)
      .then(res => res.json())
      .then(data => {
        setClaim(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [claim_id]);

  const handleDecision = async (decision) => {
    if (!comment && decision === "Rejected") {
      alert("Please provide a reason for rejection.");
      return;
    }

    setSubmitting(true);
    try {
      await fetch(`http://127.0.0.1:8000/claims/${claim_id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: comment || "Auditor approved." })
      });
      navigate("/admin");
    } catch (err) {
      console.error(err);
      alert("Failed to update decision.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderHighlightedPolicy = (text, target) => {
    if (!target || !text || target === "System") return text;
    const parts = text.split(new RegExp(`(${target})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === target.toLowerCase() ? (
        <span key={i} style={{ backgroundColor: "#000", color: "#fff", padding: "2px 4px", fontWeight: "bold" }}>{part}</span>
      ) : part
    );
  };

  const handlePrint = () => {
    // We temporarily hide the 'Back' button and the 'Override' box for a clean PDF
    const printStyles = document.createElement('style');
    printStyles.innerHTML = `
    @media print {
      button, textarea, .no-print { display: none !important; }
      body { background: white !important; padding: 0 !important; }
      .evidence-grid { display: block !important; }
      .evidence-pane { page-break-inside: avoid; border: 1px solid #eee; margin-bottom: 20px; }
    }
  `;
    document.head.appendChild(printStyles);
    window.print();
    document.head.removeChild(printStyles);
  };

  if (loading) return <div style={{ padding: '4rem', textAlign: 'center' }}>Loading Evidence...</div>;
  if (!claim || claim.error) return <div style={{ padding: '4rem', textAlign: 'center' }}>Claim not found.</div>;

  const aiDetails = claim.ai_details ? JSON.parse(claim.ai_details) : {};

  return (
    <div style={{ padding: '2rem 4rem', maxWidth: '1400px', margin: '0 auto' }}>
      <button
        onClick={() => navigate("/admin")}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2rem', fontWeight: 600 }}
      >
        <ArrowLeft size={16} /> Back to Control Center
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 className="heading-section" style={{ margin: 0 }}>Audit Claim: {claim.employee_name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '1rem', fontWeight: 600 }}>System Status:</span>
          <span className={`badge ${claim.status === 'Approved' ? 'green' : claim.status === 'Rejected' ? 'red' : 'yellow'}`} style={{ fontSize: '1rem', padding: '8px 16px' }}>
            {claim.status}
          </span>
          <button onClick={handlePrint} className="minimal-button" style={{ backgroundColor: '#f0f0f0', color: '#000' }}>
            Download Audit PDF 📄
          </button>
        </div>
      </div>

      <div className="evidence-grid">
        {/* PANE 1: Original Image */}
        <div className="evidence-pane">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', borderBottom: '2px solid #000', paddingBottom: '0.5rem', display: 'inline-block' }}>Source Document</h3>

          <div
            style={{
              overflow: 'hidden',
              borderRadius: '4px',
              border: '1px solid #eee',
              backgroundColor: '#fff',
              position: 'relative'
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setZoomStyle({ transformOrigin: 'center', transform: 'scale(1)' })}
            onClick={() => setShowLightbox(true)}
          >
            {claim.receipt_url && (
              <img
                src={claim.receipt_url}
                alt="Receipt"
                style={{
                  width: '100%',
                  cursor: 'zoom-in',
                  transition: 'transform 0.1s ease-out',
                  ...zoomStyle
                }}
              />
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: '#999', marginTop: '5px' }}>Click image to expand full view</p>
        </div>

        {/* LIGHTBOX / MODAL (Amazon/Flipkart style) */}
        {showLightbox && (
          <div
            onClick={() => setShowLightbox(false)}
            style={{
              position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
              backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 1000,
              display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer'
            }}
          >
            <button style={{ position: 'absolute', top: '20px', right: '20px', color: '#fff', background: 'none', border: 'none', fontSize: '2rem' }}>&times;</button>
            <img
              src={claim.receipt_url}
              alt="Full size"
              style={{ maxHeight: '90vh', maxWidth: '90vw', borderRadius: '4px', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}
            />
          </div>
        )}

        {/* PANE 2: Extracted Data */}
        <div className="evidence-pane">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', borderBottom: '2px solid #000', paddingBottom: '0.5rem', display: 'inline-block' }}>Parsed Telemetry</h3>
          <table className="minimal-table" style={{ marginTop: '0' }}>
            <tbody>
              <tr><th style={{ width: '40%' }}>Date</th><td style={{ fontWeight: 600 }}>{claim.date}</td></tr>
              <tr><th>Amount</th><td style={{ fontWeight: 600 }}>{claim.amount} {claim.currency}</td></tr>
              <tr><th>Category</th><td style={{ textTransform: 'capitalize' }}>{claim.category}</td></tr>
              <tr><th>Employee Grade</th><td>{claim.employee_grade || claim.grade || "Not specified"}</td></tr>
              <tr><th>Business Purpose</th><td style={{ fontSize: '0.9rem', color: '#444' }}>{claim.business_purpose}</td></tr>
              <tr>
                <th>Risk Score</th>
                <td><span style={{ color: claim.risk_score >= 70 ? 'var(--status-red)' : '#000', fontWeight: 800 }}>{claim.risk_score}</span> / 100</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* PANE 3: AI Logic & RAG Context */}
        <div className="evidence-pane" style={{ backgroundColor: '#fafafa' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', borderBottom: '2px solid #000', paddingBottom: '0.5rem', display: 'inline-block' }}>Auditor Logic</h3>
          <p style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1rem' }}>
            {aiDetails.reason || claim.ai_details}
          </p>
          <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '1.5rem' }}>
            Triggered Rule: <strong>{aiDetails.rule_reference}</strong>
          </div>

          <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#999', marginBottom: '10px' }}>Retrieved Policy Text (RAG)</h4>
          {/* In our updated backend we don't store policy_context_debug to db to save space, but if we did we could show it here.
               For this demo, we can just show that the LLM used Section X. */}
          <div style={{ fontSize: '0.8rem', backgroundColor: '#fff', border: '1px solid #ddd', padding: '10px', borderRadius: '4px', height: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {claim.policy_text_debug ? (
              renderHighlightedPolicy(claim.policy_text_debug, aiDetails.rule_reference)
            ) : claim.policy_context ? (
              renderHighlightedPolicy(claim.policy_context, aiDetails.rule_reference)
            ) : (
              "No policy evidence found for this claim ID. Please re-upload the receipt to generate new RAG evidence."
            )}
          </div>
        </div>
      </div>

      {/* DECISION OVERRIDE / FINAL DECISION BOX */}
      {claim.is_settled ? (
        <div style={{ marginTop: '3rem', padding: '2rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: claim.status === 'Approved' ? '#f0fdf4' : '#fef2f2' }}>
          <h2 className="heading-section" style={{ fontSize: '1.5rem', margin: 0, color: claim.status === 'Approved' ? 'var(--status-green)' : 'var(--status-red)' }}>
            Final Manager Decision: {claim.status}
          </h2>
          {claim.status === 'Rejected' && claim.audit_comment && (
            <div style={{ marginTop: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '8px' }}>Auditor Notes:</p>
              <p style={{ color: '#444', backgroundColor: '#fff', padding: '1rem', borderRadius: '4px', border: '1px solid #fecaca' }}>
                {claim.audit_comment}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '3rem', padding: '2rem', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: '#fff' }}>
          <h2 className="heading-section" style={{ fontSize: '1.5rem' }}>Human-in-the-Loop Override</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Review the AI's findings above. Provide a justification if you are overriding the automated system decision.
          </p>

          <textarea
            className="minimal-input"
            placeholder="Auditor notes (required for rejections)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ minHeight: '100px', resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: '20px', marginTop: '1rem' }}>
            <button
              className="minimal-button"
              style={{ backgroundColor: 'var(--status-green)' }}
              onClick={() => handleDecision("Approved")}
              disabled={submitting}
            >
              <Check size={18} /> Explicit Approve
            </button>
            <button
              className="minimal-button"
              style={{ backgroundColor: 'var(--status-red)' }}
              onClick={() => handleDecision("Rejected")}
              disabled={submitting}
            >
              <X size={18} /> Hard Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
