from rag_pipeline import load_policy, create_vector_store
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 1. Load the 40-page PDF
raw_docs = load_policy("policy.pdf")

# 2. Use a smarter splitter for complex policies
# This ensures that a limit mentioned at the end of a page 
# is still connected to the category header at the top.
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    add_start_index=True
)

docs = text_splitter.split_documents(raw_docs)

# 3. Create Vector Store with metadata
create_vector_store(docs)

print(f"✅ Vector DB created with {len(docs)} smart chunks.")