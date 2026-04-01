from groq import Groq
from dotenv import load_dotenv
import os
import json
load_dotenv() 
api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise ValueError("GROQ_API_KEY not set")

client = Groq(api_key=api_key)

# ... (existing client setup)

def get_llm_response(prompt):
    # We use a lower temperature (0) for "Precision" required in FinTech
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {
                "role": "system", 
                "content": """You are a Corporate Financial Auditor. 
                Your goal is to ensure 100% compliance and prevent 'Spend Leakage'.
                Compare the employee's Business Purpose against the Policy rules.
                Flag inconsistencies (e.g., Saturday meals with no business context)."""
            },
            {"role": "user", "content": prompt}
        ],
        temperature=0,
        response_format={"type": "json_object"}
    )
    raw_content = response.choices[0].message.content
    try:
        return json.loads(raw_content) # Return as a Dict for easy DB insertion
    except json.JSONDecodeError:
        # Fallback logic if the LLM skips a bracket
        return {"decision": "FLAG", "reason": "Audit engine parsing error", "rule_reference": "System"}