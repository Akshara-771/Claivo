from langchain_community.document_loaders import PyPDFLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
import re
from langchain_core.documents import Document

def load_policy(pdf_path):
    loader = PyPDFLoader(pdf_path)
    documents = loader.load()
    full_text = "\n".join([doc.page_content for doc in documents])

    # Improved splitting: Keeps the 40-page structure intact while indexing 
    sections = re.split(r'\n(?=\d{1,2}(?:\.\d{1,2})*\s+[A-Z])', full_text)
    docs = []

    for sec in sections:
        if not sec or len(sec) < 50: continue
        sec = sec.strip()
        match = re.match(r'(\d+(\.\d+)*)\s+(.*)', sec)
        
        section_id = match.group(1) if match else "unknown"
        section_title = match.group(3) if match else sec[:50]

        # FEATURE 2: Metadata tagging for precise "Knowledge Retrieval" 
        docs.append(
            Document(
                page_content=sec,
                metadata={
                    "section": section_id,
                    "category": normalize_expense_type(sec) 
                }
            )
        )
    return docs

# Add this to rag_pipeline.py
def create_vector_store(docs):
    """Initializes and persists the vector database from documents."""
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    
    # This creates the 'chroma_db' directory and saves your index
    db = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        persist_directory="./chroma_db"
    )
    return db

def load_vector_store():
    """Loads the existing vector database for main.py to use."""
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return Chroma(persist_directory="./chroma_db", embedding_function=embeddings)

def normalize_expense_type(raw_text: str) -> str:
    """Classifies text into categories to allow filtered RAG searches """
    raw = raw_text.lower()
    if any(w in raw for w in ["food", "meal", "dinner", "lunch", "restaurant"]): return "meals"
    if any(w in raw for w in ["taxi", "uber", "transport", "cab"]): return "ground transportation"
    if any(w in raw for w in ["hotel", "stay", "accommodation"]): return "accommodation"
    if any(w in raw for w in ["flight", "air", "airways", "airline", "e-ticket", "boarding"]): return "air travel"
    if any(w in raw for w in ["spa", "massage", "grooming", "wellness", "gym", "laundry"]): return "other"
    return "general"

def retrieve_policy(query, db, data):
    """
    Refactored for 40-page scalability: 
    Uses category filtering to prevent 'Section Confusion'[cite: 142, 159].
    """
    category = data.get("category", "general")
    
    # 1. Targeted search within the relevant category first
    results = db.similarity_search(
        query, 
        k=4, 
        filter={"category": category} # Only search relevant policy sections 
    )

    # 2. Always fetch Section 3 (Grade Limits) as it's the global reference [cite: 27]
    global_limits = db.similarity_search("spending limits grade G1 G2 G3 G4 G5", k=1)
    
    # Combine results, ensuring we don't exceed token limits
    context_docs = results + global_limits
    return "\n\n".join([doc.page_content for doc in context_docs])

def build_prompt(expense_data, policy_text):
    currency = expense_data.get('currency', 'INR')
    category = expense_data.get('category', 'general')
    
    return f"""
    You are the 'Policy-First' Auditor for Cymonic Technologies. 
    Your goal: Identify 'Spend Leakage' and 'Ambiguity'.

    POLICY CONTEXT:
    {policy_text}

    EXPENSE DATA:
    - Merchant: {expense_data.get('merchant')}
    - Amount: {expense_data.get('total_amount')} {currency}
    - Category: {category}
    - Grade: {expense_data.get('employee_grade')}
    - Business Purpose: {expense_data.get('business_purpose')}

    STRICT AUDIT LOGIC:
    1. CATEGORY LOCK: Only use rules relevant to {category}.
    2. POSITIVE MATCH: If an expense is categorized as 'other', check if it is a legitimate business-related miscellaneous expense (e.g., Visa, Courier, Office Supplies).
    3. PROHIBITED ITEMS: Explicitly REJECT personal wellness, grooming (Spas, Massages), entertainment (Cinemas), or alcohol unless specifically allowed for the user's Grade.
    4. NARRATIVE CHECK: Compare 'Business Purpose' to the actual line items. Flag inconsistencies.
    5. WEEKENDS: Flag Saturday/Sunday receipts for 'weekend justification'.
    6. LIMITS: Check Grade limits (Section 3) vs City limits (Section 5.2). Section 5.2 is the BINDING CEILING.

    RESPONSE FORMAT:
    You must return your findings in valid JSON format.
    {{
      "decision": "APPROVE/FLAG/REJECT", 
      "reason": "1-sentence explanation citing the specific policy rule or restriction", 
      "rule_reference": "Section X.X or 'Policy Exclusion'"
    }}
    """

def build_query(data):
    """
    Constructs a search query based on the expense category 
    and merchant to find the right policy section.
    """
    category = data.get("category", "general")
    merchant = data.get("merchant", "")
    if category == "other":
        return f"What are the rules for miscellaneous business expenses and the list of prohibited or non-reimbursable personal items?"
    return f"What are the eligibility rules, spending limits, and non-reimbursable exclusions for {category} or {merchant}?"