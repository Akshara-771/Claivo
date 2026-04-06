import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

BUCKET_NAME = "expense-audit-receipts-akshara"  # your bucket name
TABLE_NAME = "claims"

def generate_presigned_url(file_key):
    try:
        url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': BUCKET_NAME, 'Key': file_key},
            ExpiresIn=3600
        )
        return url
    except Exception as e:
        print(f"Error generating URL: {e}")
        return None

table = dynamodb.Table(TABLE_NAME)