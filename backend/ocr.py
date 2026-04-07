from google.cloud import vision
from google.oauth2 import service_account # Added this import
import os
import json # Added this import
from dotenv import load_dotenv

load_dotenv()

def get_vision_client():
    """Helper to initialize client from either a file path or raw JSON string"""
    creds_env = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    
    if not creds_env:
        # Fallback for local if .env is missing
        return vision.ImageAnnotatorClient()

    try:
        # Check if the environment variable is a JSON string (starts with {)
        if creds_env.strip().startswith('{'):
            info = json.loads(creds_env)
            credentials = service_account.Credentials.from_service_account_info(info)
            return vision.ImageAnnotatorClient(credentials=credentials)
        else:
            # It's a file path (standard behavior)
            return vision.ImageAnnotatorClient()
    except Exception as e:
        print(f"Credential Initialization Error: {e}")
        return vision.ImageAnnotatorClient()

def extract_text_from_image(image_bytes):
    try:
        # Use our helper to get the correctly authenticated client
        client = get_vision_client() 
        
        image = vision.Image(content=image_bytes)
        response = client.text_detection(image=image)

        if response.error.message:
            raise Exception(f"Vision API Error: {response.error.message}")

        texts = response.text_annotations

        if not texts:
            return "ERROR_UNREADABLE"

        full_text = texts[0].description.strip()
        
        if len(full_text) < 10:
            return "ERROR_BLURRY_OR_INCOMPLETE"

        return full_text

    except Exception as e:
        print("OCR ERROR:", str(e))
        return "ERROR_SYSTEM_FAILURE"