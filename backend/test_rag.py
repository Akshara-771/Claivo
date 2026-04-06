# test_rag.py
import chromadb
from langchain_community.vectorstores import Chroma
from langchain_huggingface import HuggingFaceEmbeddings

# 1. Initialize your embeddings (Must match your main code)
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

# 2. Load the existing database
# Ensure the 'persist_directory' matches where your ChromaDB files are stored
vector_db = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)

# 3. Run the query
query = "What is the specific limit for a G2 employee in New York?"
results = vector_db.similarity_search(query, k=2)

print("\n--- RAG RETRIEVAL TEST ---")
for i, doc in enumerate(results):
    print(f"\nChunk {i+1}:")
    print(doc.page_content)
    print(f"Source: {doc.metadata.get('source', 'Unknown')}")