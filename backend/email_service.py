import os
from dotenv import load_dotenv
load_dotenv()

import boto3
from botocore.exceptions import ClientError

# --- AWS Configuration ---
# Your IAM Role handles the credentials, but the Region and Sender stay as config
SES_REGION = os.getenv("AWS_REGION", "us-east-1")
# The verified email address from your .env file
SES_SENDER = os.getenv("SES_SENDER_EMAIL") 

ses_client = boto3.client('ses', region_name=SES_REGION)

def send_audit_email(recipient, subject, body_html):
    if not SES_SENDER:
        print("SES Error: SES_SENDER_EMAIL not set in environment.")
        return False

    try:
        response = ses_client.send_email(
            Destination={'ToAddresses': [recipient]},
            Message={
                'Body': {'Html': {'Charset': "UTF-8", 'Data': body_html}},
                'Subject': {'Charset': "UTF-8", 'Data': subject},
            },
            Source=f"Claivo <{SES_SENDER}>", # Formats it professionally
        )
        return True
    except ClientError as e:
        print(f"SES Error: {e.response['Error']['Message']}")
        return False