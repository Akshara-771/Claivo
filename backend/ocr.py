from google.cloud import vision
import os

# 1. Set the environment variable (using double backslashes for Windows)
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "D:\\FinTech-Expense_Auditor\\backend\\gcp_key.json"

def extract_text_from_image(image_bytes):
    try:
        # 2. No need to pass 'credentials' here; it pulls from os.environ automatically
        client = vision.ImageAnnotatorClient() 
        
        image = vision.Image(content=image_bytes)
        response = client.text_detection(image=image)

        if response.error.message:
            raise Exception(f"Vision API Error: {response.error.message}")

        texts = response.text_annotations

        if not texts:
            # FEATURE 1 REQUIREMENT: Feedback for unreadable receipts
            return "ERROR_UNREADABLE"

        full_text = texts[0].description.strip()
        
        # Simple heuristic: If text is too short, it's likely a bad scan
        if len(full_text) < 10:
            return "ERROR_BLURRY_OR_INCOMPLETE"

        return full_text

    except Exception as e:
        # Log the error for the terminal but return a string for the backend logic
        print("OCR ERROR:", str(e))
        return "ERROR_SYSTEM_FAILURE"