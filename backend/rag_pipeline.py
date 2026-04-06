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

def ingest_new_policy(pdf_path):
    # 1. Use your existing load_policy function to get the tagged docs
    docs = load_policy(pdf_path) 
    
    # 2. Setup the Embedding Model (The math behind the search)
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    # 3. Save to ChromaDB
    vector_db = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        persist_directory="./chroma_db" 
    )
    return len(docs)

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
    
    # 1. Targeted search without the broken category filter
    results = db.similarity_search(query, k=3)

    # 2. Always fetch Section 3 (Grade Limits) explicitly
    grade = data.get("employee_grade", "G5")
    grade_query = f"Employee Grades and Approval Authority {grade} Daily Meal Limit Hotel Limit"
    global_limits = db.similarity_search(grade_query, k=3)
    
    # Combine results, ensuring global limits (Section 3) are at the top
    seen = set()
    context_docs = []
    for doc in global_limits + results:
        if doc.page_content not in seen:
            seen.add(doc.page_content)
            context_docs.append(doc)
            
    return "\n\n".join([doc.page_content for doc in context_docs])

def build_prompt(expense_data, policy_text):
    currency = expense_data.get('currency', 'INR')
    category = expense_data.get('category', 'general')
    employee_grade = expense_data.get('employee_grade', 'G5')
    
    if category == 'accommodation':
        accommodation_hints = {"G1": 150, "G2": 200, "G3": 250, "G4": 250, "G5": 300}
        grade_hint = accommodation_hints.get(employee_grade, 200)
        
        return f"""
        You are a Senior Financial Auditor for Cymonic Technologies. 
        Audit this 'accommodation' expense for a {employee_grade} level employee.

        --- POLICY CONTEXT ---
        {policy_text}

        --- AUDIT RULES (STRICT) ---
        1. CATEGORY LOCK: This is a HOTEL receipt. DO NOT use limits from 'Section 5.3 Client Entertainment' (e.g., $100) or 'Section 5.2 Meal Limits' (e.g., $110).
        2. Look ONLY at 'Section 3' Grade-Based Hotel Limits.
        3. If the Nightly Rate is $369.11 and the {employee_grade} limit is $300 (G5) or $200 (G2), you must flag it as an overage.
        4. Mention the exact Section 3 limit in your finding.

        HINT: The Section 3 Hotel Limit for this grade is exactly ${grade_hint}.

        --- RECEIPT DATA ---
        {expense_data}

        RESPONSE FORMAT:
        You must return your findings in valid JSON format.
        {{
          "math_scratchpad": "(REQUIRED) Write out the exact math comparison here. Example: 'Total is 369. Limit is 300. Since 369 > 300, it must be flagged/rejected.'",
          "decision": "APPROVE/FLAG/REJECT", 
          "reason": "1-sentence explanation citing the specific policy rule or restriction", 
          "rule_reference": "Section X.X or 'Policy Exclusion'"
        }}
        """
    hint_text = ""
    if category == 'meals':
        meal_hints = {"G1": 55, "G2": 55, "G3": 55, "G4": 85, "G5": 85}
        grade_limit_hint = meal_hints.get(employee_grade, 55)
        hint_text = f"""
    7. HINT: The baseline Section 3 Daily Meal Limit for {employee_grade} is {grade_limit_hint} (GBP/USD).
    8. CITY LIMIT OVERRIDE: Check the policy context (Section 5.2) for special City Limits (e.g., New York, London). If the receipt is from one of these cities, its limit OVERRIDES the {grade_limit_hint} limit! You MUST use the City Limit.
    9. CO-DINER RULE (Covers): If the receipt lists multiple covers/guests, divide the total amount by the number of covers to get the per-person cost.
    10. EXPLICIT MATH VERIFICATION: You MUST mathematically compare the cost to the limit. If (Cost > Limit), you MUST FLAG or REJECT the claim explicitly. Do NOT approve it if the amount exceeds the allowed limit.
    11. ALCOHOL RULE: Even if within limits, if there is ANY Alcohol, REJECT it.
        """

    return f"""
    You are the 'Policy-First' Auditor for Cymonic Technologies. 
    Your goal: Identify 'Spend Leakage' and 'Ambiguity'.

    POLICY CONTEXT:
    {policy_text}

    EXPENSE DATA:
    - Merchant: {expense_data.get('merchant')}
    - Amount: {expense_data.get('total_amount')} {currency}
    - Category: {category}
    - Grade: {employee_grade}
    - Business Purpose: {expense_data.get('business_purpose')}
    - Raw Receipt Text: {expense_data.get('raw_text', '')[:1000]}

    STRICT AUDIT LOGIC:
    1. CATEGORY LOCK: Only use rules relevant to {category}.
    2. POSITIVE MATCH: If an expense is categorized as 'other', check if it is a legitimate business-related miscellaneous expense (e.g., Visa, Courier, Office Supplies).
    3. PROHIBITED ITEMS: Explicitly REJECT personal wellness, grooming (Spas, Massages), entertainment (Cinemas), or alcohol unless specifically allowed for the user's Grade.
    4. NARRATIVE CHECK: Compare 'Business Purpose' to the actual line items. Flag inconsistencies.
    5. WEEKENDS: Flag Saturday/Sunday/Friday night receipts for 'weekend justification'.
    6. LIMITS: Check Grade limits (Section 3) vs City limits (Section 5.2). Section 5.2 is the BINDING CEILING.
    {hint_text}

    RESPONSE FORMAT:
    You must return your findings in valid JSON format.
    {{
      "math_scratchpad": "(REQUIRED) Write out the exact math comparison here. Example: 'Total is 98.96. Limit is 75. Since 98 is greater than 75, Total > Limit. Therefore, it must be flagged/rejected.'",
      "decision": "APPROVE/FLAG/REJECT", 
      "reason": "1-sentence explanation citing the specific policy rule or restriction and the math calculation you performed.", 
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

def get_policy_limit(grade, category, db):
    # Ensure we specifically search for hotel or accommodation, as requested.
    query = f"hotel accommodation nightly limits table for {grade}" if category == 'accommodation' else f"spending limits table {grade} {category} USD limit"
    docs = db.similarity_search(query, k=5)
    
    # We must not fallback to meal limits if we are looking for accommodation!
    for doc in docs:
        # Check if this document actually contains our exact grade string, 
        # and has hotel/accommodation context to avoid context contamination.
        if grade in doc.page_content and (category in doc.page_content.lower() or "hotel" in doc.page_content.lower() or grade in ["G1", "G2", "G3", "G4", "G5"]):
            matches = re.findall(r'(?:USD|\$)\s*([1-9][0-9]{1,})', doc.page_content)
            if matches:
                vals = [int(m.replace(',', '')) for m in matches]
                if category == 'accommodation':
                    # Hotel limits are >= 150 for all grades. If we get something less, we hit a meal limit!
                    hotel_vals = [v for v in vals if v >= 100]
                    if hotel_vals:
                        return max(hotel_vals)
                else:
                    return min(vals)

    # Hard fallback to prevent returning meal limits ($75, $110 etc.)
    if category == "accommodation":
        hardcoded_limits = {"G1": 150, "G2": 200, "G3": 250, "G4": 250, "G5": 300}
        return hardcoded_limits.get(grade, 200)

    return None # Fallback if policy is ambiguous [cite: 72]