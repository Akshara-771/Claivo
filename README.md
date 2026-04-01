# Claivo
An AI-powered expense auditing system that uses RAG and a deterministic rule engine to automatically cross-reference digital receipts against complex corporate policies for real-time compliance.

---

## ● The Problem

Corporate finance teams manually cross-reference every employee receipt against complex, multi-page expense policies, leading to slow reimbursements and inconsistent audits.  

Spending limits vary by seniority and location, creating **"Spend Leakage"** where non-compliant claims accidentally slip through.

---

## ● The Solution

Clairvo automates the auditing process by simultaneously **analyzing expense receipts and company policy documents** to deliver an instant compliance verdict.

### Key Features

- **Intelligent Ingestion**  
  Automated extraction of *Merchant, Date, Amount, and Currency* using **Google Cloud Vision OCR**

- **Hybrid Audit Engine**  
  Combines:
  - **Deterministic Rule Engine** → ensures 100% mathematical accuracy  
  - **RAG-based AI** → enables semantic policy reasoning  

- **Multi-Layer Validation**  
  Automatic checks for:
  - Prohibited items (Alcohol, Spa)
  - Grade-based limits (G1–G5)
  - City-specific international caps  

- **Smart Flagging**  
  Detects:
  - Weekend discretionary spending  
  - High-value executive expenses requiring CFO notification  

---

## ● Tech Stack

- **Languages:** Python 3.10+, JavaScript (React)  
- **Backend:** FastAPI  
- **Frontend:** React.js  

### Cloud Infrastructure
- AWS S3 — receipt storage  
- DynamoDB — claims database   

### AI & ML Stack
- **LLM:** Groq API (LLaMA 3.1 8B Instant)  
- **Vector Database:** ChromaDB (local, section-chunked policy index)  
- **Embeddings:** sentence-transformers/all-MiniLM-L6-v2 (HuggingFace)  
- **OCR:** Google Cloud Vision API  
- **RAG Framework:** LangChain  

---

## ● Setup Instructions

### 1. Prerequisites

Ensure you have the following installed:

- Python 3.10+
- Node.js

---

### 2. Installation

Clone the repository and install dependencies:

```bash
pip install -r requirements.txt
```

---

### 3. Environment Configuration

Create a `.env` file in the root directory and add:

```env
GROQ_API_KEY=your_groq_api_key
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=your_region
GOOGLE_APPLICATION_CREDENTIALS=backend/gcp_key.json
```

---

### 4. Running the Project Locally

#### Start the FastAPI Backend

```bash
uvicorn main:app --reload
```

#### Start the React Frontend

```bash
npm start
```

---

### Access the Application

Open your browser and navigate to:

http://localhost:3000

---

## ● License

This project is developed as part of a technical challenge and is intended for demonstration purposes.
