# AI Expense Auditor - Approach Document

## 1. Problem Statement
Manual expense auditing is slow, inconsistent, and hard to scale. Finance teams spend time validating receipts, checking policy limits, and handling ambiguous claims. This project automates first-pass auditing while keeping humans in control for overrides.

## 2. Solution Overview
The solution is an AI-powered expense auditor with two core user roles:
- **Employee Portal:** submit receipts and expense context.
- **Finance Dashboard:** review AI outcomes, investigate evidence, and override decisions.

Each claim goes through an automated pipeline:
1. File ingestion (JPG/PNG/PDF) and metadata capture.
2. OCR + field extraction (merchant, date, amount, currency).
3. Policy retrieval (RAG) from company policy PDF.
4. AI audit decision (`Approved`, `Flagged`, `Rejected`) with policy-cited reason.
5. Storage, risk scoring, and optional human override + email notification.

## 3. Technical Approach

### 3.1 Frontend
- Built with React.
- Employee form captures receipt file, business purpose, employee info, category, and date.
- Real-time feedback on submission success/failure.
- Admin dashboard supports filtering, sorting, and claim-level review.

### 3.2 Backend
- Built with FastAPI.
- `/upload` handles file upload, OCR trigger, extraction, policy retrieval, and audit decision.
- `/claims` and `/claims/{claim_id}` expose claim records for dashboard views.
- `/claims/{claim_id}/decision` supports human override and final settlement flow.

### 3.3 Data and Cloud
- **S3:** stores uploaded receipt files.
- **DynamoDB:** stores structured claim records and audit metadata.
- **SES:** sends status/decision notification emails.

### 3.4 AI Pipeline
- **OCR:** Google Cloud Vision API extracts raw text from receipts.
- **Extraction logic:** regex and heuristic parsing for merchant/date/amount/currency.
- **Policy engine (RAG):** LangChain + ChromaDB retrieve relevant policy sections.
- **Audit model:** Groq-hosted Llama model returns structured JSON decision and reason.

**Hybrid audit architecture:** A deterministic rule engine runs before the LLM and handles absolute policy violations with 100% accuracy - alcohol detection, personal expense classification, grade-based meal limits, international city caps, and weekend flagging. The LLM only handles cases the rule engine doesn't cover. Rule engine decisions always take precedence over LLM output, preventing AI hallucination on black-and-white policy violations.

## 4. Beyond Minimum Requirements
- Human-in-the-loop override with auditor comments and settlement tracking.
- Risk scoring (`0-100`) and priority labels for triage.
- Duplicate detection via visual hash and semantic matching.
- Currency normalization to USD for consistent policy checks.
- Policy snippet visibility for transparent audit evidence.
- PDF preprocessing and OCR fallback handling for reliability.

## 5. Implementation Plan (High-Level)
- **Phase 1:** Project scaffolding, cloud setup, health checks.
- **Phase 2:** Upload portal and backend ingestion to S3 + DynamoDB.
- **Phase 3:** OCR extraction and validation (date checks, unreadable detection).
- **Phase 4:** Policy RAG indexing and retrieval quality tuning.
- **Phase 5:** LLM audit decisioning + structured output parsing.
- **Phase 6:** Finance dashboard, override flow, and notifications.
- **Phase 7:** Deployment hardening, CORS/env config, end-to-end testing.

## 6. Validation and Testing Strategy
- Functional tests for upload, extraction, policy retrieval, and audit endpoints.
- 11 sample receipts tested across all 5 employee grades (G1-G5), covering meals, transport, accommodation, air travel, and prohibited expenses across 6 currencies and 5 cities.
- Edge case tests: blurry images, missing fields, duplicate submissions, PDF receipts.
- Manual verification that decision reasons cite correct policy context.

## 7. Expected Impact
- Reduces manual review effort and turnaround time.
- Improves consistency of policy enforcement.
- Increases audit transparency through explainable AI outputs.
- Provides a scalable foundation for enterprise expense governance.

## 8. Future Improvements and Enhancements
- **User Authentication & Access Control**: Integrate a secure login system (e.g., AWS Cognito) to support role-based access for employees and finance auditors, along with personalized claim history and audit trails.
- **Predictive Spend Analytics**: Leverage historical data from DynamoDB to build a predictive dashboard that identifies departmental spending patterns and highlights potential "spend leakage" before it occurs.
- **Interactive Policy Assistant**: Implement a RAG-powered "Audit Chatbot" that allows employees to query policy compliance (e.g., "Am I eligible for a flight upgrade?") before they even make a purchase.
- **Automated Anomaly Detection**: Deploy machine learning models to detect non-obvious fraud, such as "split-claiming" or frequent submissions just below mandatory receipt thresholds.