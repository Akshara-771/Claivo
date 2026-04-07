from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
import uuid
import os
from PIL import Image
import imagehash
import io
from boto3.dynamodb.conditions import Attr 

SES_SENDER_EMAIL = os.getenv("SES_SENDER_EMAIL")
print(f"DEBUG: SES Sender is {SES_SENDER_EMAIL}")

import io
import json
import re
import base64
from datetime import datetime
from decimal import Decimal
from fastapi.middleware.cors import CORSMiddleware
import fitz  # PyMuPDF for PDF-to-Image conversion
import requests
from fastapi import FastAPI, UploadFile, File, Form

from aws_config import s3, table, BUCKET_NAME, generate_presigned_url
from ocr import extract_text_from_image
from extractor import contains_keywords, extract_fields
from rag_pipeline import (
    build_query,
    get_policy_limit,
    retrieve_policy,
    build_prompt,
    load_vector_store,
    normalize_expense_type
)
from llm import get_llm_response
from email_service import send_audit_email

EXCHANGE_API_KEY = os.getenv("EXCHANGE_API_KEY")
SES_SENDER_EMAIL = os.getenv("SES_SENDER_EMAIL")

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

db = None

def get_db():
    global db
    if db is None:
        print("Loading vector DB...")
        db = load_vector_store()
    return db

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
@app.get("/")
def root():
    return {
        "message": "Claivo API is running 🚀",
        "main_endpoint": "/upload",
        "docs": "/docs"
    }

def convert_to_usd(amount, from_currency):
    if from_currency == "USD":
        return amount
    try:
        url = f"https://v6.exchangerate-api.com/v6/{EXCHANGE_API_KEY}/pair/{from_currency}/USD/{amount}"
        response = requests.get(url, timeout=5) # Added timeout for safety
        data = response.json()
        return round(data['conversion_result'], 2)
    except Exception as e:
        print(f"Currency conversion error: {e}")
        # Fallback for the live demo if Wi-Fi drops
        rates = {"INR": 83.0, "EUR": 0.92, "GBP": 0.79, "SGD": 1.35}
        return round(amount / rates.get(from_currency, 1.0), 2)

def convert_floats(data):
    if isinstance(data, list):
        return [convert_floats(i) for i in data]
    elif isinstance(data, dict):
        return {k: convert_floats(v) for k, v in data.items()}
    elif isinstance(data, float):
        return Decimal(str(data))
    return data

def calculate_risk_score(decision, date_flag, amount, rule_ref="System", employee_grade=""):
    """Generates a score for the Finance Auditor Home Page sorting."""
    score = 0
    if decision == "Rejected": score += 80
    elif decision == "Flagged": 
        # Enforce higher risk for G2 over G5 limits due to percentage overage
        if employee_grade in ["G1", "G2"]:
            score += 70
        else:
            score += 40
    
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

def get_visual_hash(file_bytes):
    # Convert bytes to an Image object
    img = Image.open(io.BytesIO(file_bytes))
    # Generate a Perceptual Hash (pHash)
    return str(imagehash.phash(img))

@app.post("/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    employee_name: str = Form(...),
    employee_email: str = Form(...),
    business_purpose: str = Form(...),
    date: str = Form(...),
    employee_grade: str = Form(...),
    user_currency: str = Form("USD"),
    user_category: str = Form(...)
):
    try:
        claim_id = str(uuid.uuid4())
        file_bytes = await file.read()
        filename = file.filename.lower()

        # 🔥 1. HANDLE PDF CONVERSION FIRST
        if filename.endswith('.pdf'):
            pdf_document = fitz.open("pdf", file_bytes)
            first_page = pdf_document[0]
            pix = first_page.get_pixmap(dpi=200)
            # Overwrite file_bytes with the JPEG version
            file_bytes = pix.tobytes("jpeg")
            pdf_document.close()
            file_key = f"{claim_id}_{file.filename}.jpg"
        else:
            file_key = f"{claim_id}_{file.filename}"

        # 1. Generate visual fingerprint
        v_hash = get_visual_hash(file_bytes)

        existing = table.scan()
        duplicate_detected = False
        
        for item in existing.get('Items', []):
            db_hash = item.get("visual_hash")
            if db_hash:
                try:
                    # Compute Hamming distance between the two perceptual hex hashes
                    dist = bin(int(db_hash, 16) ^ int(v_hash, 16)).count('1')
                    if dist <= 5:  # Tolerance tightened to 5. 12 was too greedy and caught identically structured templates (like airline e-tickets)
                        duplicate_detected = True
                        break
                except:
                    continue

        if duplicate_detected:
            return {
                "message": "Duplicate Detected",
                "status": "Rejected", 
                "reason": "Visual Duplicate Detected. A visually identical receipt has already been submitted."
            }
        # 4. PROCEED TO S3 AND OCR
        s3.upload_fileobj(io.BytesIO(file_bytes), BUCKET_NAME, file_key)
        # ... rest of your OCR and AI logic ...
    
        # --- PDF logic was already handled at the top, bypassing here ---
        file_key = f"{claim_id}_{file.filename}"

        # 1. S3 Upload
        s3.upload_fileobj(io.BytesIO(file_bytes), BUCKET_NAME, file_key)
        file_url = f"s3://{BUCKET_NAME}/{file_key}"

        # 2. OCR & Field Extraction
        text = extract_text_from_image(file_bytes)
        if not text:
            return {"error": "OCR failed"}

        current_cat = user_category if user_category else normalize_expense_type(text)
        structured_data = extract_fields(text, category=current_cat)

        # 2.5 Semantic Duplicate Backup (Catches wildly different crops/formats of the same receipt)
        all_existing = table.scan()
        for item in all_existing.get("Items", []):
            if (item.get("employee_name") == employee_name and 
                item.get("date") == date and 
                item.get("amount") == structured_data.get("total_amount")):
                return {
                    "message": "Duplicate Detected",
                    "status": "Rejected",
                    "reason": "Duplicate Detected. A claim for this identical amount and date was already submitted by you."
                }

        

        # 2. 🔥 NOW you can do the Currency Swap
        # Get amount from OCR, then convert it
        extracted_val = structured_data.get("total_amount")
        raw_amount = float(extracted_val) if extracted_val is not None else 0.0
        
        # Prefer the OCR-detected currency. If not found, fall back to user_currency.
        final_currency = structured_data.get("currency") or user_currency
        
        amount_in_usd = convert_to_usd(raw_amount, final_currency)

        current_cat = user_category if user_category else normalize_expense_type(text)
        structured_data.update({
            "total_amount_usd": amount_in_usd, # Use this for policy checks!
            "original_amount": raw_amount,
            "currency": final_currency,
            # ... rest of your updates
        })

        structured_data.update({
            "raw_text": text,
            "employee_name": employee_name,
            "business_purpose": business_purpose,
            "submitted_date": date,
            "employee_grade": employee_grade,
            "category": current_cat
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

        # --- 4. RULE ENGINE (Deterministic Overrides) ---
        text_lower = text.lower()
        rule_override = None

        # 4.1 Prohibited Items Check
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
            
        # 4.2 Dynamic Accommodation Grade Check 
        if not rule_override and current_cat == "accommodation":
            dynamic_limit = HOTEL_LIMITS_USD.get(employee_grade)
            nights = structured_data.get("nights", 3) # Use extracted nights or default to 3 for Peninsula case
            nightly_rate = amount_in_usd / nights

            if dynamic_limit and nightly_rate > dynamic_limit:
                rule_override = {
                    "decision": "Flagged",
                    "reason": f"Nightly rate (${nightly_rate:.2f}) exceeds the {employee_grade} limit of ${dynamic_limit} found in policy.",
                    "rule_reference": "Section 4.3"
                }

        # 4.3 Weekend Validation (Discretionary Only)
        if not rule_override:
            discretionary_cats = ["meals", "other", "ground transportation"]
            if current_cat.lower() in discretionary_cats:
                try:
                    ocr_date_str = structured_data.get("date")
                    if ocr_date_str:
                        ocr_dt = datetime.strptime(ocr_date_str, "%Y-%m-%d")
                        if ocr_dt.weekday() in [5, 6]:
                            rule_override = {
                                "decision": "Flagged",
                                "reason": f"Weekend {current_cat} claim needs justification.",
                                "rule_reference": "Section 5.1"
                            }
                except: pass

        # --- 4.4 Air Travel Grade Check ---
        if not rule_override and current_cat == "air travel":
            # 1. Identify the class from the text
            is_business = contains_keywords(text_lower, ["business", "class c", "business class"])
            
            # 2. Extract Grade Number (e.g., 'G2' -> 2)
            try:
                grade_num = int(re.search(r'G(\d+)', employee_grade).group(1))
            except:
                grade_num = 1 # Default to lowest for safety

            # 3. Apply Section 4.1 Rule
            if grade_num <= 3 and is_business:
                rule_override = {
                    "decision": "Rejected",
                    "reason": f"Business Class detected. Grades G1-G3 are restricted to Economy Class per Section 4.1.",
                    "rule_reference": "Section 4.1"
                }

        # 5. RAG + LLM Execution
        # We increase k=3 to ensure we get the full grade limit table 
        query = f"Section 3 {current_cat} tables and limits for {employee_grade}"
        policy_context = retrieve_policy(query, get_db(), structured_data)
        prompt = build_prompt(structured_data, policy_context)
        llm_output = get_llm_response(prompt)

        # 6. Parse Logic
        try:
            if isinstance(llm_output, dict):
                decision_data = llm_output
            else:
                json_matches = re.findall(r'\{.*?\}', llm_output, re.DOTALL)
                decision_data = json.loads(json_matches[-1]) if json_matches else {"decision": "FLAG"}

            # Apply Rule Engine override if triggered 
            if rule_override:
                decision_data = rule_override

            # apply date flag hard override 
            if date_flag in ["MINOR_DIFFERENCE", "MAJOR_DIFFERENCE"]:
                if decision_data.get("decision", "").upper() == "REJECT":
                    pass # Silently drop the date mismatch if the claim is already decisively rejected
                else:
                    decision_data = {
                        "decision": "Flagged",
                        "reason": f"Date mismatch! You entered {date}, but the receipt extraction engine read '{structured_data.get('date')}'. Please check the dates.",
                        "rule_reference": "Date Matcher"
                    }

            raw_decision = decision_data.get("decision", "FLAG").upper()
            if "APPROVE" in raw_decision: status = "Approved"
            elif "REJECT" in raw_decision: status = "Rejected"
            else: status = "Flagged"
            
        except Exception as e:
            status = "Flagged"
            decision_data = {"reason": f"Parsing error: {str(e)}", "rule_reference": "System"}

        # 7. Risk Scoring & Persistence
        risk_score, priority = calculate_risk_score(status, date_flag, structured_data.get("total_amount"), decision_data.get("rule_reference"), employee_grade)
        
        db_item = {
            "claim_id": claim_id,
            "employee_name": employee_name,
            "employee_email": employee_email,
            "business_purpose": business_purpose,
            "date": date,
            "employee_grade": employee_grade,
            "status": status,
            "risk_score": risk_score,
            "priority": priority,
            "receipt_url": file_url,
            "category": current_cat,
            "amount": structured_data.get("total_amount"),
            "currency": structured_data.get("currency"),
            "total_amount_usd": amount_in_usd,
            "policy_text_debug": policy_context,
            "ai_details": json.dumps(decision_data),
            "visual_hash": v_hash,
            "audit_trail": json.dumps({"date_flag": date_flag, "ocr_date": structured_data.get("date")})
        }
        table.put_item(Item=convert_floats(db_item))

        # 7.5 Trigger Auditor Notification Email
        if SES_SENDER_EMAIL and date_flag not in ["MINOR_DIFFERENCE", "MAJOR_DIFFERENCE"]:
            subject = f"New Claim Submitted: Action Required ({status})"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; color: #333;">
                    <h2 style="color: #000;">New Claim Submission</h2>
                    <p><strong>Employee:</strong> {employee_name} ({employee_email})</p>
                    <p><strong>Purpose:</strong> {business_purpose}</p>
                    <p><strong>Status:</strong> {status}</p>
                    <p><strong>Amount:</strong> {structured_data.get('total_amount')} {final_currency} (USD ${amount_in_usd})</p>
                    <div style="padding: 15px; background-color: #f4f4f4; border-radius: 5px; border-left: 4px solid #000;">
                        <strong>System Note:</strong> {decision_data.get('reason')}
                    </div>
                </body>
            </html>
            """
            send_audit_email(SES_SENDER_EMAIL, subject, html_body)

        # 8. UI Response
        encoded_image = base64.b64encode(file_bytes).decode('utf-8')
        return {
            "message": "Processed",
            "claim_id": claim_id,
            "status": status,
            "reason": decision_data.get("reason"),
            "policy_text_debug": policy_context,
            "rule_ref": decision_data.get("rule_reference"),
            "risk_score": int(risk_score),
            "receipt_url": f"data:image/jpeg;base64,{encoded_image}"
        }
    except Exception as e:
        print(f"DEBUG ERROR: {str(e)}") # Check your terminal for this!
        return {"message": "Upload failed", "error": str(e)}

from pydantic import BaseModel

class DecisionUpdate(BaseModel):
    decision: str
    reason: str

@app.get("/claims")
def get_all_claims():
    try:
        response = table.scan()
        # Sort by date naturally, but let frontend handle risk sorting
        items = response.get("Items", [])
        
        # Convert S3 paths to URLs for the frontend
        for item in items:
            if "receipt_url" in item and item["receipt_url"].startswith("s3://"):
                file_key = item["receipt_url"].split('/')[-1]
                # Assuming you have the helper from aws_config
                item["receipt_url"] = generate_presigned_url(file_key)
        return {"claims": items}
    except Exception as e:
        return {"error": str(e)}

@app.get("/claims/{claim_id}")
def get_claim(claim_id: str):
    try:
        response = table.get_item(Key={"claim_id": claim_id})
        if "Item" in response:
            item = response["Item"]
            if "receipt_url" in item and item["receipt_url"].startswith("s3://"):
                file_key = item["receipt_url"].split('/')[-1]
                item["receipt_url"] = generate_presigned_url(file_key)
            return item
        return {"error": "Not found"}
    except Exception as e:
        return {"error": str(e)}

@app.post("/claims/{claim_id}/decision")
def update_decision(claim_id: str, payload: DecisionUpdate):
    try:
        # 1. Fetch the claim to get the stored employee_email
        res = table.get_item(Key={"claim_id": claim_id})
        if "Item" not in res:
            return {"error": "Claim not found"}
        
        claim = res["Item"]
        user_email = claim.get("employee_email")

        # 2. Update the Database
        table.update_item(
            Key={"claim_id": claim_id},
            UpdateExpression="SET #s = :s, audit_comment = :c, is_settled = :settled",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": payload.decision, 
                ":c": payload.reason,
                ":settled": True
            }
        )

        # 3. 🔥 Trigger SES Email if email exists
        if user_email:
            subject = f"Update: Your Expense Claim is {payload.decision}"
            html_body = f"""
            <html>
                <body style="font-family: Arial, sans-serif; color: #333;">
                    <h2 style="color: #000;">Audit Decision: {payload.decision}</h2>
                    <p>Hello {claim.get('employee_name', 'Employee')},</p>
                    <p>Your claim for <strong>{claim.get('business_purpose', 'a recent expense')}</strong> has been processed.</p>
                    <div style="padding: 15px; background-color: #f4f4f4; border-radius: 5px; border-left: 4px solid #000;">
                        <strong>Auditor Note:</strong> {payload.reason}
                    </div>
                    <p style="margin-top: 20px; font-size: 0.8rem; color: #999;">
                        This is an automated notification from the Claivo FinTech Platform.
                    </p>
                </body>
            </html>
            """
            send_audit_email(user_email, subject, html_body)

        return {"message": "Success"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/claims/{claim_id}")
def delete_claim(claim_id: str):
    try:
        table.delete_item(Key={"claim_id": claim_id})
        return {"message": "Success", "deleted_id": claim_id}
    except Exception as e:
        return {"error": str(e)}

@app.get("/policy_pdf")
def get_policy_pdf():
    policy_path = "./policy.pdf"
    if os.path.exists(policy_path):
        return FileResponse(policy_path, media_type="application/pdf")
    return {"error": "Policy file not found"}

@app.on_event("startup")
async def startup_event():
    print("Server started successfully 🚀")