import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

BUCKET_NAME = "expense-audit-receipts-akshara"  # your bucket name
TABLE_NAME = "claims"

table = dynamodb.Table(TABLE_NAME)