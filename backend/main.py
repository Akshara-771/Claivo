from fastapi import FastAPI, UploadFile, File, Form
import uuid
import io
import json
import re
import base64
from datetime import datetime
from decimal import Decimal
from fastapi.middleware.cors import CORSMiddleware

from aws_config import s3, table, BUCKET_NAME
from ocr import extract_text_from_image
from extractor import contains_keywords, extract_fields
from rag_pipeline import (
    build_query,
    retrieve_policy,
    build_prompt,
    load_vector_store,
    normalize_expense_type
)
from llm import get_llm_response

# --- RULE ENGINE CONSTANTS ---
ALCOHOL_KEYWORDS = ["wine", "beer", "whisky", "vodka", "gin", "rum", "cocktail", "alcohol", "liquor"]
PERSONAL_KEYWORDS = ["spa", "massage", "salon", "haircut", "gym", "grooming", "facial", "wellness", "relaxation"]
# City-Specific Daily Meal Limits from Section 5.2
CITY_LIMITS = {
    "New York": {"limit": 75, "currency": "USD"},
    "San Francisco": {"limit": 80, "currency": "USD"},
    "London": {"limit": 55, "currency": "GBP"},
    "Singapore": {"limit": 70, "currency": "SGD"},
    "Dubai": {"limit": 180, "currency": "AED"},
    "Tokyo": {"limit": 5000, "currency": "JPY"},
    "Munich": {"limit": 55, "currency": "EUR"},
    "Frankfurt": {"limit": 55, "currency": "EUR"},
    "Sydney": {"limit": 75, "currency": "AUD"}
}
HOTEL_LIMITS_USD = {
    "G1": 150,
    "G2": 200,
    "G3": 250,
    "G4": 250,
    "G5": 300  # Note: 580 still triggers a flag for G5!
}
# -----------------------------

# Initialize app
app = FastAPI()

# Load vector DB once
db = load_vector_store()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def convert_floats(data):
    if isinstance(data, list):
        return [convert_floats(i) for i in data]
    elif isinstance(data, dict):
        return {k: convert_floats(v) for k, v in data.items()}
    elif isinstance(data, float):
        return Decimal(str(data))
    return data

def calculate_risk_score(decision, date_flag, amount, rule_ref="System"):
    """Generates a score for the Finance Auditor Home Page sorting."""
    score = 0
    if decision == "Rejected": score += 80
    elif decision == "Flagged": score += 40
    
    if date_flag == "MAJOR_DIFFERENCE": score += 15
    
    try:
        val = float(amount) if amount else 0
    except:
        val = 0

    if val > 5000: score += 5 
    if val > 10000: score += 15 
    
    if rule_ref and rule_ref != "System": score += 5 
    
    score = min(score, 100)
    priority = "High" if score >= 70 else "Medium" if score >= 35 else "Low"
    return score, priority

@app.post("/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    employee_name: str = Form(...),
    business_purpose: str = Form(...),
    date: str = Form(...),
    employee_grade: str = Form(...),
    user_category: str = Form(...)
):
    try:
        claim_id = str(uuid.uuid4())
        file_key = f"{claim_id}_{file.filename}"
        file_bytes = await file.read()

        # 1. S3 Upload
        s3.upload_fileobj(io.BytesIO(file_bytes), BUCKET_NAME, file_key)
        file_url = f"s3://{BUCKET_NAME}/{file_key}"

        # 2. OCR & Field Extraction
        text = extract_text_from_image(file_bytes)
        if not text:
            return {"error": "OCR failed"}

        structured_data = extract_fields(text)
        structured_data.update({
            "raw_text": text,
            "employee_name": employee_name,
            "business_purpose": business_purpose,
            "submitted_date": date,
            "employee_grade": employee_grade,
            "category": user_category if user_category else normalize_expense_type(text)
        })

        if not structured_data.get("total_amount") or not structured_data.get("date"):
            return {"message": "Unreadable receipt", "status": "Rejected", "claim_id": claim_id}

        # 3. Date Validation
        date_flag = "MATCH"
        try:
            ocr_dt = datetime.strptime(structured_data["date"], "%Y-%m-%d")
            input_dt = datetime.strptime(date, "%Y-%m-%d")
            diff = abs((input_dt - ocr_dt).days)
            if diff > 2: date_flag = "MAJOR_DIFFERENCE"
            elif diff > 0: date_flag = "MINOR_DIFFERENCE"
        except: date_flag = "UNKNOWN"
        structured_data["date_flag"] = date_flag

        # --- 3.5 RULE ENGINE (Deterministic Overrides) ---
        text_lower = text.lower()
        rule_override = None

        if contains_keywords(text_lower, ALCOHOL_KEYWORDS):
            rule_override = {
                "decision": "REJECT", 
                "reason": "Alcohol detected in receipt. Not reimbursable per Section 5.1.", 
                "rule_reference": "Section 5.1"
            }
        elif contains_keywords(text_lower, PERSONAL_KEYWORDS):
            rule_override = {
                "decision": "REJECT", 
                "reason": "Personal wellness/grooming expense detected. Strictly prohibited per Section 7.", 
                "rule_reference": "Section 7"
            }
        # --- 3.6 Weekend Validation Rule ---
        if not rule_override:
            try:
                # Using the date extracted by OCR
                ocr_date_str = structured_data.get("date")
                if ocr_date_str:
                    ocr_dt = datetime.strptime(ocr_date_str, "%Y-%m-%d")
                    # 5 is Saturday, 6 is Sunday
                    if ocr_dt.weekday() in [5, 6]:
                        rule_override = {
                            "decision": "Flagged",
                            "reason": f"Saturday receipt ({ocr_date_str}) — weekend claim needs justification.",
                            "rule_reference": "STRICT AUDIT RULE 3"
                        }
            except Exception as e:
                print(f"DEBUG: Weekend check failed: {e}")
            
            # --- 3.7 Dynamic Accommodation Grade Check ---
            if not rule_override and structured_data.get("category") == "accommodation":
                grade = employee_grade
                limit = HOTEL_LIMITS_USD.get(grade, 0)
    
                # Use extracted 'nights' or 'nightly_rate' if available from structured_data
                # Most hotel folios explicitly list 'USD XXX/nt' or 'Number of Nights'
                total = float(structured_data.get("total_amount", 0))
                nights = structured_data.get("nights") # Extracted by your 'extractor.py'
    
                if nights and nights > 0:
                    nightly_rate = total / nights
                    if nightly_rate > limit:
                        rule_override = {
                            "decision": "Flagged",
                            "reason": f"Nightly rate (${nightly_rate:.2f}) exceeds {grade} limit of ${limit}.",
                            "rule_reference": "Section 4.3"
                        }
                elif "nt" in text.lower() or "night" in text.lower():
                    # Fallback: If we see the keywords but can't math it, let the LLM handle it
                    # This prevents the Rule Engine from being 'too specific'
                    pass
        # 3. NEW: Dynamic City-Specific Override
        current_cat = user_category if user_category else normalize_expense_type(text)
        structured_data["category"] = current_cat

        # --- 3.6 Weekend Validation Rule ---
        # ONLY flag discretionary spending (Meals, Other, Transport)
        discretionary_cats = ["meals", "other", "ground transportation"]
        
        if current_cat.lower() in discretionary_cats:
            try:
                ocr_date_str = structured_data.get("date")
                if ocr_date_str:
                    ocr_dt = datetime.strptime(ocr_date_str, "%Y-%m-%d")
                    # 5 = Saturday, 6 = Sunday
                    if ocr_dt.weekday() in [5, 6]:
                        rule_override = {
                            "decision": "Flagged",
                            "reason": f"Weekend {current_cat} claim needs justification.",
                            "rule_reference": "Section 5.1"
                        }
            except:
                pass
        else:
            # IMPORTANT: If it's Air Travel, we explicitly ensure no override exists
            rule_override = None

        # 4. RAG + LLM Execution
        query = build_query(structured_data)
        policy_context = retrieve_policy(query, db, structured_data)
        prompt = build_prompt(structured_data, policy_context)
        llm_output = get_llm_response(prompt)

        # 5. Fix Parse Logic (Integrated)
        try:
            # Handle cases where Groq SDK returns a dict instead of a raw string
            if isinstance(llm_output, dict):
                decision_data = llm_output
            else:
                json_matches = re.findall(r'\{.*?\}', llm_output, re.DOTALL)
                if json_matches:
                    decision_data = json.loads(json_matches[-1])
                else:
                    raise ValueError("No JSON found in LLM output string")

            # Apply Rule Engine override if it was triggered
            if rule_override:
                decision_data = rule_override

            raw_decision = decision_data.get("decision", "FLAG").upper()
            if "APPROVE" in raw_decision: status = "Approved"
            elif "REJECT" in raw_decision: status = "Rejected"
            else: status = "Flagged"
            
        except Exception as e:
            print(f"DEBUG ERROR: Parsing failed: {e}")
            status = "Flagged"
            decision_data = {"reason": "Parsing error", "rule_reference": "System"}

        # 6. Risk Scoring
        risk_score, priority = calculate_risk_score(
            status, 
            date_flag, 
            structured_data.get("total_amount"),
            decision_data.get("rule_reference", "System")
        )

        # 7. Persistence
        db_item = {
            "claim_id": claim_id,
            "employee_name": employee_name,
            "business_purpose": business_purpose,
            "date": date,
            "status": status,
            "risk_score": risk_score,
            "priority": priority,
            "receipt_url": file_url,
            "category": structured_data["category"],
            "amount": structured_data.get("total_amount"),
            "currency": structured_data.get("currency"),
            "ai_details": json.dumps(decision_data),
            "audit_trail": json.dumps({"date_flag": date_flag, "ocr_date": structured_data.get("date")})
        }
        table.put_item(Item=convert_floats(db_item))

        # 8. UI Prep: Convert image to Data URI for instant preview
        encoded_image = base64.b64encode(file_bytes).decode('utf-8')
        image_data_uri = f"data:image/jpeg;base64,{encoded_image}"

        print(f"--- LLM OUTPUT --- \n{llm_output}")
        print(f"--- FINAL STATUS --- \n{status}")

        return {
            "message": "Processed",
            "claim_id": claim_id,
            "status": status,
            "risk_score": risk_score,
            "reason": decision_data.get("reason", "No reason provided"),
            "policy_text_debug": policy_context,
            "rule_ref": decision_data.get("rule_reference"),
            "receipt_url": image_data_uri, # Bypasses S3 403 Forbidden errors for UI
            "audit_trail": {"date_flag": date_flag}
        }

    except Exception as e:
        print(f"CRITICAL ERROR: {str(e)}")
        return {"message": "Upload failed", "error": str(e)}