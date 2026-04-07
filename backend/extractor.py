from email.mime import text
import re

from datetime import datetime

def contains_keywords(text, keywords):
    for word in keywords:
        if re.search(r'\b' + re.escape(word) + r'\b', text):
            return True
    return False

def extract_fields(text, category=None):
    print("EXTRACTOR VERSION: NEW (Category Aware)")
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
    MONTH_MAP = {
        "january": "01", "february": "02", "march": "03",
        "april": "04", "may": "05", "june": "06",
        "july": "07", "august": "08", "september": "09",
        "october": "10", "november": "11", "december": "12",
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "jun": "06", "jul": "07", "aug": "08", "sep": "09",
        "oct": "10", "nov": "11", "dec": "12"
    }
    month_pattern = "|".join(MONTH_MAP.keys())
    
    extracted_dates = []

    # Format A: DD Month YYYY
    for match in re.finditer(fr'(\d{{1,2}})\s+({month_pattern})\s+(\d{{4}})', text, re.IGNORECASE):
        day = match.group(1).zfill(2)
        month_word = match.group(2).lower()
        year = match.group(3)
        extracted_dates.append(f"{year}-{MONTH_MAP[month_word]}-{day}")

    # Format B: Month YYYY with preceding day (Fallback)
    for fallback in re.finditer(fr'({month_pattern})\s+(\d{{4}})', text, re.IGNORECASE):
        month_word = fallback.group(1).lower()
        year = fallback.group(2)
        day_match = re.search(r'(\d{1,2})\s+' + re.escape(fallback.group(1)), text, re.IGNORECASE)
        day = day_match.group(1).zfill(2) if day_match else "01"
        extracted_dates.append(f"{year}-{MONTH_MAP[month_word]}-{day}")

    # Format C: YYYY-MM-DD
    for match in re.finditer(r'(\d{4}-\d{2}-\d{2})', text):
        extracted_dates.append(match.group(1))

    # Format D: DD/MM/YYYY
    for match in re.finditer(r'(\d{1,2})/(\d{1,2})/(\d{4})', text):
        extracted_dates.append(f"{match.group(3)}-{match.group(2).zfill(2)}-{match.group(1).zfill(2)}")

    # Deduplicate and validate dates
    valid_dates = []
    for d_str in set(extracted_dates):
        try:
            # Quick check if it's a real date
            datetime.strptime(d_str, "%Y-%m-%d")
            valid_dates.append(d_str)
        except ValueError:
            pass

    if valid_dates:
        valid_dates.sort()
        # For flights and hotels, take the max date (checkout/return)
        if category and category.lower() in ["air travel", "accommodation"]:
            data["date"] = valid_dates[-1] 
        else:
            # Normal logic: just take the earliest / first parsed (or could just take valid_dates[0], but let's take the latest fallback to avoid print dates from months ago)
            # Alternatively, original logic just took the first match. Because valid_dates is sorted, valid_dates[0] is the earliest. 
            data["date"] = valid_dates[0]
            
        print(f"EXTRACTED DATES: {valid_dates} -> CHOSEN: {data['date']}")

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
    # -------- 5. Nights (for Accommodation) --------
    data["nights"] = 1  # Default to 1 to avoid division by zero
    
    # Look for "X nights" or "X night" or "Night(s): X"
    nights_match = re.search(r'(\d+)\s*night', text, re.IGNORECASE)
    if nights_match:
        data["nights"] = int(nights_match.group(1))
    else:
        # Fallback: check for common hotel date ranges (e.g., 10-13 March)
        # For Receipt 10 specifically, it says "March 10-13, 2025"
        date_range = re.search(r'(\d{1,2})-(\d{1,2})\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', text, re.IGNORECASE)
        if date_range:
            start, end = int(date_range.group(1)), int(date_range.group(2))
            data["nights"] = max(1, end - start)

    

    return data