from email.mime import text
import re

from sqlalchemy import text
from datetime import datetime

def contains_keywords(text, keywords):
    for word in keywords:
        if re.search(r'\b' + re.escape(word) + r'\b', text):
            return True
    return False

def extract_fields(text):
    print("EXTRACTOR VERSION: NEW")
    data = {
        "merchant": None,
        "date": None,
        "total_amount": None,
        "currency": None
    }

    # Strip auth codes and receipt numbers before parsing amounts
    text_clean = re.sub(r'(Auth|Authorization|Receipt No|Ref No|Ref|Tax ID)[:\s]+[\w\-]+', '', text, flags=re.IGNORECASE)

    lines = [line.strip() for line in text.split("\n") if line.strip()]

    # -------- 1. Merchant --------
    for line in lines[:10]:
        if not any(word in line.lower() for word in [
            "gst", "date", "time", "table", "covers", "tax", "receipt", "gstin"
        ]):
            if len(line) > 3:
                data["merchant"] = line
                break

    # -------- 2. Date (multiple formats) --------
    # Manual month map avoids locale issues on Windows
    MONTH_MAP = {
        "january": "01", "february": "02", "march": "03",
        "april": "04", "may": "05", "june": "06",
        "july": "07", "august": "08", "september": "09",
        "october": "10", "november": "11", "december": "12"
    }


    # Try DD Month YYYY (Modified to handle trailing punctuation)
    # -------- 2. Date (multiple formats) --------
    MONTH_MAP = {
        "january": "01", "february": "02", "march": "03",
        "april": "04", "may": "05", "june": "06",
        "july": "07", "august": "08", "september": "09",
        "october": "10", "november": "11", "december": "12"
    }

    # 1. Create a regex-friendly list of months
    month_pattern = "|".join(MONTH_MAP.keys())

    # 2. Strict Anchor Regex: (Day) (Space) (Specific Month Name) (Space) (Year)
    # This forces the middle group to be a month name, preventing it from grabbing "singapore"
    match = re.search(fr'(\d{{1,2}})\s+({month_pattern})\s+(\d{{4}})', text, re.IGNORECASE)

    if match:
        day = match.group(1).zfill(2)
        month_word = match.group(2).lower()
        year = match.group(3)
        data["date"] = f"{year}-{MONTH_MAP[month_word]}-{day}"
        print(f"DATE MATCHED: {data['date']}")
    else:
        # 3. Emergency Fallback: If the OCR put a dot or weird char after the year
        # This specifically looks for 'March 2025' and works backwards
        fallback = re.search(fr'({month_pattern})\s+(\d{{4}})', text, re.IGNORECASE)
        if fallback:
            month_word = fallback.group(1).lower()
            year = fallback.group(2)
            # Look for the digits immediately preceding the month
            day_match = re.search(r'(\d{1,2})\s+' + re.escape(fallback.group(1)), text, re.IGNORECASE)
            day = day_match.group(1).zfill(2) if day_match else "01"
            data["date"] = f"{year}-{MONTH_MAP[month_word]}-{day}"

    # Try YYYY-MM-DD if still None
    if not data["date"]:
        match = re.search(r'(\d{4}-\d{2}-\d{2})', text)
        if match:
            data["date"] = match.group(1)

    # Try DD/MM/YYYY if still None
    if not data["date"]:
        idx = text.find("2025")
        if idx > 0:
            snippet = text[idx-15:idx+10]
            print("RAW AROUND DATE:", repr(snippet))
        match = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', text)
        print("DATE REGEX MATCH:", match.group(0) if match else "NO MATCH")
        if match:
            data["date"] = f"{match.group(3)}-{match.group(2).zfill(2)}-{match.group(1).zfill(2)}"

    # -------- 3. Currency --------
    if "SGD" in text:
        data["currency"] = "SGD"
    elif "GBP" in text or "£" in text:
        data["currency"] = "GBP"
    elif "USD" in text or "$" in text:
        data["currency"] = "USD"
    elif "EUR" in text or "€" in text:
        data["currency"] = "EUR"
    elif "AED" in text:
        data["currency"] = "AED"
    elif "JPY" in text or "¥" in text:
        data["currency"] = "JPY"
    elif "INR" in text or "Rs" in text or "₹" in text:
        data["currency"] = "INR"

    # -------- 4. Total amount --------
    # Step 1: Find amounts after TOTAL, using cleaned text, with currency symbol required
    total_section = re.search(r'TOTAL([\s\S]{0,200})', text_clean, re.IGNORECASE)
    if total_section:
        after_total = total_section.group(1)
        total_regex = r'(?:INR|Rs\.?|₹|GBP|SGD|USD|AED|EUR|£|\$)\s*[\s\n]*([\d,]+(?:\.\d{1,2})?)'
        amounts_after_total = re.findall(total_regex, after_total, re.IGNORECASE)
        cleaned = []
        for m in amounts_after_total:
            try:
                val = float(m.replace(",", ""))
                if 1 < val < 10000:  # sanity cap — no receipt exceeds 10,000
                    cleaned.append(val)
            except ValueError:
                continue
        if cleaned:
            data["total_amount"] = max(cleaned)

    # Step 2: Fallback — largest currency-prefixed amount in entire cleaned receipt
    if data["total_amount"] is None:
        all_amounts = re.findall(
            r'(?:Rs\.?|₹|GBP|SGD|USD|AED|EUR|£|\$)\s*([\d,]+(?:\.\d{1,2})?)',
            text_clean
        )
        cleaned = []
        for m in all_amounts:
            try:
                val = float(m.replace(",", ""))
                if val < 10000:
                    cleaned.append(val)
            except ValueError:
                continue
        if cleaned:
            data["total_amount"] = max(cleaned)

    return data